const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Environment variables (you'll set these in Render)
const ABC_API_URL = process.env.ABC_API_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const GHL_API_URL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ====================================
// UTILITY FUNCTIONS
// ====================================

/**
 * Fetch members from ABC platform
 * @param {string} clubNumber - The club number
 * @param {string} startDate - Optional start date (YYYY-MM-DD)
 * @param {string} endDate - Optional end date (YYYY-MM-DD)
 * @param {string} activeStatus - Optional active status filter (default: "Active")
 * @param {string} memberStatus - Optional member status filter (default: "active")
 * @returns {Promise<Array>} Array of members
 */
async function fetchMembersFromABC(clubNumber, startDate = null, endDate = null, activeStatus = 'Active', memberStatus = 'active') {
    try {
        const url = `${ABC_API_URL}/${clubNumber}/members`;
        
        // Build query parameters
        const params = {
            activeStatus: activeStatus,
            memberStatus: memberStatus
        };
        
        // ABC uses convertedDateRange format: "2025-10-31,2025-11-05"
        if (startDate && endDate) {
            params.convertedDateRange = `${startDate},${endDate}`;
        } else if (startDate) {
            // If only startDate, use today as endDate
            const today = new Date().toISOString().split('T')[0];
            params.convertedDateRange = `${startDate},${today}`;
        }
        
        console.log(`Fetching members from ABC: ${url}`, params);
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            },
            params: params
        });
        
        // ABC returns members in response.data.members array
        const members = response.data.members || [];
        console.log(`Successfully fetched ${members.length} members from ABC`);
        return members;
        
    } catch (error) {
        console.error('Error fetching from ABC:', error.message);
        if (error.response) {
            console.error('ABC API Response:', error.response.data);
        }
        throw new Error(`ABC API Error: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Add or update a contact in GoHighLevel
 * @param {Object} member - Member data from ABC
 * @returns {Promise<Object>} GHL response
 */
async function syncContactToGHL(member) {
    try {
        // Map ABC member data to GHL contact format
        const personal = member.personal || {};
        const agreement = member.agreement || {};
        
        const contactData = {
            locationId: GHL_LOCATION_ID,
            firstName: personal.firstName || '',
            lastName: personal.lastName || '',
            email: personal.email || '',
            phone: personal.primaryPhone || personal.mobilePhone || '',
            address1: personal.addressLine1 || '',
            city: personal.city || '',
            state: personal.state || '',
            postalCode: personal.postalCode || '',
            country: personal.countryCode || '',
            tags: ['sale'], // Add 'sale' tag to all synced contacts
            // Add custom fields
            customFields: [
                { key: 'abc_member_id', value: member.memberId || '' },
                { key: 'abc_club_number', value: personal.homeClub || '' },
                { key: 'barcode', value: personal.barcode || '' },
                { key: 'birth_date', value: personal.birthDate || '' },
                { key: 'gender', value: personal.gender || '' },
                { key: 'member_status', value: personal.memberStatus || '' },
                { key: 'join_status', value: personal.joinStatus || '' },
                { key: 'membership_type', value: agreement.membershipType || '' },
                { key: 'payment_plan', value: agreement.paymentPlan || '' },
                { key: 'agreement_number', value: agreement.agreementNumber || '' },
                { key: 'sales_person', value: agreement.salesPersonName || '' },
                { key: 'converted_date', value: agreement.convertedDate || '' },
                { key: 'sign_date', value: agreement.signDate || '' },
                { key: 'next_billing_date', value: agreement.nextBillingDate || '' },
                { key: 'is_past_due', value: agreement.isPastDue || '' },
                { key: 'total_check_in_count', value: personal.totalCheckInCount || '' },
                { key: 'last_check_in', value: personal.lastCheckInTimestamp || '' }
            ]
        };
        
        const headers = {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        
        // First, search for existing contact by email
        let contactExists = false;
        let existingContactId = null;
        
        try {
            // Search using query parameter
            const searchResponse = await axios.get(`${GHL_API_URL}/contacts/`, {
                headers: headers,
                params: { 
                    locationId: GHL_LOCATION_ID,
                    query: contactData.email
                }
            });
            
            // Check if we found the contact
            if (searchResponse.data && searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
                // Find exact email match
                const exactMatch = searchResponse.data.contacts.find(
                    c => c.email && c.email.toLowerCase() === contactData.email.toLowerCase()
                );
                
                if (exactMatch) {
                    contactExists = true;
                    existingContactId = exactMatch.id;
                    console.log(`Found existing contact: ${contactData.email} (ID: ${existingContactId})`);
                }
            }
        } catch (searchError) {
            console.log(`Contact search failed, will try to create: ${contactData.email}`);
        }
        
        // Update or Create contact
        if (contactExists && existingContactId) {
            // UPDATE existing contact - REMOVE locationId for update
            try {
                const updateData = { ...contactData };
                delete updateData.locationId; // locationId not allowed in update
                
                const updateUrl = `${GHL_API_URL}/contacts/${existingContactId}`;
                const response = await axios.put(updateUrl, updateData, { headers: headers });
                console.log(`✅ Updated contact in GHL: ${contactData.email}`);
                return { action: 'updated', contact: response.data };
            } catch (updateError) {
                console.error(`Update failed for ${contactData.email}:`, updateError.response?.data);
                throw updateError;
            }
            
        } else {
            // CREATE new contact - locationId IS required here
            try {
                const createUrl = `${GHL_API_URL}/contacts/`;
                const response = await axios.post(createUrl, contactData, { headers: headers });
                console.log(`✅ Created contact in GHL: ${contactData.email}`);
                return { action: 'created', contact: response.data };
                
            } catch (createError) {
                // If create fails with duplicate error, try to find and update
                if (createError.response?.data?.message?.includes('duplicated') || 
                    createError.response?.data?.message?.includes('duplicate')) {
                    
                    console.log(`Duplicate detected for ${contactData.email}, searching again...`);
                    
                    // Try a more thorough search
                    try {
                        const retrySearch = await axios.get(`${GHL_API_URL}/contacts/`, {
                            headers: headers,
                            params: { 
                                locationId: GHL_LOCATION_ID,
                                query: contactData.email
                            }
                        });
                        
                        if (retrySearch.data?.contacts?.length > 0) {
                            const foundContact = retrySearch.data.contacts[0];
                            const updateData = { ...contactData };
                            delete updateData.locationId; // Remove for update
                            
                            const updateUrl = `${GHL_API_URL}/contacts/${foundContact.id}`;
                            const response = await axios.put(updateUrl, updateData, { headers: headers });
                            console.log(`✅ Updated existing duplicate: ${contactData.email}`);
                            return { action: 'updated', contact: response.data };
                        }
                    } catch (retryError) {
                        console.error(`Failed to handle duplicate for ${contactData.email}`);
                    }
                }
                
                throw createError;
            }
        }
        
    } catch (error) {
        console.error('Error syncing to GHL:', error.message);
        if (error.response) {
            console.error('GHL API Response:', error.response.data);
        }
        throw new Error(`GHL API Error: ${error.response?.data?.message || error.message}`);
    }
}

// ====================================
// API ENDPOINTS
// ====================================

// Home endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'ABC to GHL Member Sync Server',
        status: 'running',
        features: {
            autoYesterdaySync: 'Automatically syncs members who signed yesterday',
            membershipFiltering: 'Excludes NON-MEMBER and Employee types',
            autoTagging: 'Adds "sale" tag to all synced contacts',
            customFields: 'Syncs 15+ fields including membership type and sign date'
        },
        endpoints: {
            'GET /': 'This message',
            'GET /api/health': 'Health check',
            'POST /api/sync': 'Sync members (auto-uses yesterday if no dates)',
            'POST /api/sync-daily': 'Daily sync - always syncs yesterday',
            'POST /api/sync/:clubNumber': 'Sync specific club',
            'GET /api/test-abc': 'Test ABC API connection',
            'GET /api/test-ghl': 'Test GHL API connection'
        },
        configuration: {
            abc_api: ABC_APP_ID && ABC_APP_KEY ? 'configured' : 'NOT CONFIGURED',
            ghl_api: GHL_API_KEY && GHL_LOCATION_ID ? 'configured' : 'NOT CONFIGURED'
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apis: {
            abc: ABC_APP_ID && ABC_APP_KEY ? 'configured' : 'missing',
            ghl: GHL_API_KEY && GHL_LOCATION_ID ? 'configured' : 'missing'
        }
    });
});

// Test ABC API connection
app.get('/api/test-abc', async (req, res) => {
    const { clubNumber } = req.query;
    
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({ 
            error: 'ABC_APP_ID and ABC_APP_KEY not configured',
            configured: {
                app_id: ABC_APP_ID ? 'yes' : 'no',
                app_key: ABC_APP_KEY ? 'yes' : 'no'
            }
        });
    }
    
    if (!clubNumber) {
        return res.status(400).json({ error: 'clubNumber parameter required' });
    }
    
    try {
        const members = await fetchMembersFromABC(clubNumber);
        res.json({
            success: true,
            message: 'ABC API connection successful',
            memberCount: members.length || 0,
            sample: members[0] || null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test GHL API connection with detailed diagnostics
app.get('/api/test-ghl', async (req, res) => {
    if (!GHL_API_KEY) {
        return res.status(500).json({ error: 'GHL_API_KEY not configured' });
    }
    
    if (!GHL_LOCATION_ID) {
        return res.status(500).json({ 
            error: 'GHL_LOCATION_ID not configured',
            message: 'Please add your GHL Location ID as environment variable'
        });
    }
    
    try {
        const testUrl = `${GHL_API_URL}/contacts/`;
        const headers = {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        const params = { 
            locationId: GHL_LOCATION_ID,
            limit: 1 
        };
        
        console.log('Testing GHL API...');
        console.log('URL:', testUrl);
        console.log('Headers:', { ...headers, Authorization: `Bearer ${GHL_API_KEY.substring(0, 20)}...` });
        console.log('Params:', params);
        
        const response = await axios.get(testUrl, {
            headers: headers,
            params: params
        });
        
        res.json({
            success: true,
            message: 'GHL API connection successful',
            locationId: GHL_LOCATION_ID,
            contactCount: response.data.contacts?.length || 0
        });
        
    } catch (error) {
        // Detailed error information
        const errorDetails = {
            success: false,
            error: error.message,
            statusCode: error.response?.status,
            statusText: error.response?.statusText,
            ghlError: error.response?.data,
            requestInfo: {
                url: `${GHL_API_URL}/contacts/`,
                locationId: GHL_LOCATION_ID,
                keyPrefix: GHL_API_KEY.substring(0, 20) + '...',
                keyLength: GHL_API_KEY.length
            }
        };
        
        console.error('GHL API Test Failed:', JSON.stringify(errorDetails, null, 2));
        
        res.status(500).json(errorDetails);
    }
});

// Main sync endpoint with parameters
app.post('/api/sync', async (req, res) => {
    let { clubNumber, clubNumbers, startDate, endDate } = req.body;
    
    // Validate required configuration
    if (!ABC_APP_ID || !ABC_APP_KEY || !GHL_API_KEY || !GHL_LOCATION_ID) {
        return res.status(500).json({
            error: 'API keys not configured',
            abc_app_id: ABC_APP_ID ? 'ok' : 'missing',
            abc_app_key: ABC_APP_KEY ? 'ok' : 'missing',
            ghl_api_key: GHL_API_KEY ? 'ok' : 'missing',
            ghl_location_id: GHL_LOCATION_ID ? 'ok' : 'missing'
        });
    }
    
    // Validate club number(s)
    if (!clubNumber && !clubNumbers) {
        return res.status(400).json({
            error: 'clubNumber or clubNumbers required',
            example: {
                clubNumber: '30935'
            }
        });
    }
    
    // AUTO-CALCULATE YESTERDAY'S DATE if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0]; // Format: YYYY-MM-DD
        endDate = startDate; // Same day
        console.log(`No dates provided. Auto-set to yesterday: ${startDate}`);
    }
    
    try {
        // Handle multiple clubs or single club
        const clubs = clubNumbers || [clubNumber];
        const results = {
            totalClubs: clubs.length,
            totalMembers: 0,
            created: 0,
            updated: 0,
            skipped: 0,
            errors: 0,
            dateRange: startDate && endDate ? `${startDate} to ${endDate}` : 'all time',
            clubs: []
        };
        
        // Excluded membership types
        const excludedMembershipTypes = ['NON-MEMBER', 'Employee'];
        
        // Process each club
        for (const club of clubs) {
            console.log(`\n=== Processing Club: ${club} ===`);
            const clubResult = {
                clubNumber: club,
                members: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                skippedMembers: [],
                errors: [],
                startTime: new Date().toISOString()
            };
            
            try {
                // Fetch members from ABC
                const members = await fetchMembersFromABC(club, startDate, endDate);
                clubResult.members = members.length || 0;
                results.totalMembers += clubResult.members;
                
                console.log(`Fetched ${members.length} members from ABC`);
                
                // Sync each member to GHL
                for (const member of members) {
                    try {
                        const membershipType = member.agreement?.membershipType || '';
                        
                        // FILTER: Skip excluded membership types
                        if (excludedMembershipTypes.includes(membershipType)) {
                            console.log(`Skipping member ${member.personal?.email || member.memberId} - Membership type: ${membershipType}`);
                            clubResult.skipped++;
                            results.skipped++;
                            clubResult.skippedMembers.push({
                                email: member.personal?.email,
                                name: `${member.personal?.firstName} ${member.personal?.lastName}`,
                                membershipType: membershipType,
                                reason: 'Excluded membership type'
                            });
                            continue;
                        }
                        
                        const result = await syncContactToGHL(member);
                        
                        if (result.action === 'created') {
                            clubResult.created++;
                            results.created++;
                        } else if (result.action === 'updated') {
                            clubResult.updated++;
                            results.updated++;
                        }
                        
                    } catch (memberError) {
                        clubResult.errors.push({
                            member: member.personal?.email || member.memberId,
                            error: memberError.message
                        });
                        results.errors++;
                    }
                }
                
            } catch (clubError) {
                clubResult.errors.push({
                    error: clubError.message
                });
                results.errors++;
            }
            
            clubResult.endTime = new Date().toISOString();
            results.clubs.push(clubResult);
        }
        
        console.log('\n=== Sync Complete ===');
        console.log(`Total Members: ${results.totalMembers}`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Skipped: ${results.skipped}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Sync completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync specific club (simplified endpoint)
app.post('/api/sync/:clubNumber', async (req, res) => {
    const { clubNumber } = req.params;
    const { startDate, endDate } = req.body;
    
    // Redirect to main sync endpoint
    req.body.clubNumber = clubNumber;
    return app._router.handle(req, res);
});

// Daily sync endpoint - automatically syncs yesterday's signups
app.post('/api/sync-daily', async (req, res) => {
    let { clubNumber, clubNumbers } = req.body;
    
    // Default to club 30935 if no club specified
    if (!clubNumber && !clubNumbers) {
        clubNumber = '30935';
        console.log('No club specified, defaulting to club 30935');
    }
    
    // Calculate yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    console.log(`\n=== Daily Sync: ${yesterdayStr} ===`);
    
    // Call main sync with yesterday's date
    req.body.startDate = yesterdayStr;
    req.body.endDate = yesterdayStr;
    req.body.clubNumber = clubNumber;
    req.body.clubNumbers = clubNumbers;
    
    // Use the main sync endpoint
    return app._router.handle(req, res);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Internal Server Error',
        message: err.message
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 ABC to GHL Sync Server`);
    console.log(`📍 Running on http://localhost:${PORT}`);
    console.log(`\n🔑 Configuration Status:`);
    console.log(`   ABC App ID: ${ABC_APP_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   ABC App Key: ${ABC_APP_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   GHL API Key: ${GHL_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   GHL Location ID: ${GHL_LOCATION_ID ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`\n📝 Ready to sync members!\n`);
});
