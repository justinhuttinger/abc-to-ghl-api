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
 * @returns {Promise<Array>} Array of members
 */
async function fetchMembersFromABC(clubNumber, startDate = null, endDate = null) {
    try {
        const url = `${ABC_API_URL}/${clubNumber}/members`;
        
        // ABC's date filters don't work reliably, so fetch all and filter in code
        const params = {};
        
        console.log(`Fetching all members from ABC club ${clubNumber}`);
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            },
            params: params
        });
        
        let members = response.data.members || [];
        console.log(`ABC returned ${members.length} total members`);
        
        // Filter by signDate if date range provided
        if (startDate && endDate) {
            console.log(`Filtering by signDate between ${startDate} and ${endDate}`);
            
            members = members.filter(member => {
                const signDate = member.agreement?.signDate;
                if (!signDate) return false;
                
                // Extract just the date part (YYYY-MM-DD)
                const memberDate = signDate.split('T')[0];
                
                // Check if date falls in range
                return memberDate >= startDate && memberDate <= endDate;
            });
            
            console.log(`Filtered to ${members.length} members with signDate in range`);
        }
        
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
 * Fetch cancelled/inactive members from ABC
 * @param {string} clubNumber - The club number
 * @param {string} startDate - Start date for memberStatusDate range
 * @param {string} endDate - End date for memberStatusDate range
 * @returns {Promise<Array>} Array of cancelled members
 */
async function fetchCancelledMembersFromABC(clubNumber, startDate, endDate) {
    try {
        const url = `${ABC_API_URL}/${clubNumber}/members`;
        
        // ABC's date filters don't work reliably, fetch all and filter in code
        const params = {};
        
        console.log(`Fetching all members from ABC club ${clubNumber}`);
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            },
            params: params
        });
        
        let members = response.data.members || [];
        console.log(`ABC returned ${members.length} total members`);
        
        // Filter for Cancelled OR Expired status
        members = members.filter(member => {
            const status = member.personal?.memberStatus;
            return status === 'Cancelled' || status === 'Expired';
        });
        
        console.log(`Filtered to ${members.length} Cancelled/Expired members`);
        
        // Filter by memberStatusDate if date range provided
        if (startDate && endDate) {
            console.log(`Filtering by memberStatusDate between ${startDate} and ${endDate}`);
            
            members = members.filter(member => {
                const statusDate = member.personal?.memberStatusDate;
                if (!statusDate) return false;
                
                // Extract just the date part (YYYY-MM-DD)
                const memberDate = statusDate.split('T')[0];
                
                // Check if date falls in range
                return memberDate >= startDate && memberDate <= endDate;
            });
            
            console.log(`Filtered to ${members.length} with memberStatusDate in range`);
        }
        
        console.log(`Final count:`);
        console.log(`  - Cancelled: ${members.filter(m => m.personal?.memberStatus === 'Cancelled').length}`);
        console.log(`  - Expired: ${members.filter(m => m.personal?.memberStatus === 'Expired').length}`);
        
        return members;
        
    } catch (error) {
        console.error('Error fetching cancelled members from ABC:', error.message);
        if (error.response) {
            console.error('ABC API Response:', error.response.data);
        }
        throw new Error(`ABC API Error: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Fetch recurring services from ABC
 * @param {string} clubNumber - The club number
 * @param {string} startDate - Optional start date for filtering
 * @param {string} endDate - Optional end date for filtering
 * @param {string} serviceStatus - Optional status filter (Active/Inactive)
 * @param {string} filterType - 'sale' or 'inactive' to determine which date range to use
 * @returns {Promise<Array>} Array of recurring services
 */
async function fetchRecurringServicesFromABC(clubNumber, startDate = null, endDate = null, serviceStatus = null, filterType = 'sale') {
    try {
        const url = `${ABC_API_URL}/${clubNumber}/members/recurringservices`;
        
        const params = {};
        
        // Filter by sale date or inactive date
        if (startDate && endDate) {
            if (filterType === 'sale') {
                params.saleTimestampRange = `${startDate},${endDate}`;
            } else if (filterType === 'inactive') {
                params.lastModifiedTimestampRange = `${startDate},${endDate}`;
            }
        }
        
        if (serviceStatus) {
            params.serviceStatus = serviceStatus;
        }
        
        console.log(`Fetching recurring services from ABC: ${url}`, params);
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            },
            params: params
        });
        
        const services = response.data.recurringServices || [];
        console.log(`Successfully fetched ${services.length} recurring services from ABC`);
        return services;
        
    } catch (error) {
        console.error('Error fetching recurring services from ABC:', error.message);
        if (error.response) {
            console.error('ABC API Response:', error.response.data);
        }
        throw new Error(`ABC API Error: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Search for contact in GHL by name
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @returns {Promise<Object|null>} Contact object or null if not found
 */
async function searchGHLByName(firstName, lastName) {
    try {
        const headers = {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        
        // Search by full name
        const searchQuery = `${firstName} ${lastName}`;
        console.log(`Searching GHL for: ${searchQuery}`);
        
        const searchResponse = await axios.get(`${GHL_API_URL}/contacts/`, {
            headers: headers,
            params: { 
                locationId: GHL_LOCATION_ID,
                query: searchQuery
            }
        });
        
        if (!searchResponse.data?.contacts?.length) {
            console.log(`❌ No contacts found for ${searchQuery}`);
            return null;
        }
        
        const contacts = searchResponse.data.contacts;
        console.log(`Found ${contacts.length} potential matches for ${searchQuery}`);
        
        // Try to find exact name match (case insensitive)
        const exactMatch = contacts.find(c => 
            c.firstName?.toLowerCase() === firstName.toLowerCase() &&
            c.lastName?.toLowerCase() === lastName.toLowerCase()
        );
        
        if (exactMatch) {
            console.log(`✅ Found exact match: ${exactMatch.firstName} ${exactMatch.lastName} (${exactMatch.email})`);
            return exactMatch;
        }
        
        // If no exact match but only one result, use it
        if (contacts.length === 1) {
            console.log(`✅ Using single result: ${contacts[0].firstName} ${contacts[0].lastName} (${contacts[0].email})`);
            return contacts[0];
        }
        
        // Multiple contacts but no exact match
        console.log(`⚠️ Multiple contacts found but no exact match`);
        return null;
        
    } catch (error) {
        console.error(`Error searching GHL for ${firstName} ${lastName}:`, error.message);
        return null;
    }
}

/**
 * Add tag to existing contact in GHL by contact ID
 * @param {string} contactId - GHL Contact ID
 * @param {string} tag - Tag to add
 * @param {Array} existingTags - Existing tags array
 * @returns {Promise<Object>} Result object
 */
async function addTagToContactById(contactId, tag, existingTags = []) {
    try {
        const headers = {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        
        // Check if tag already exists
        if (existingTags.includes(tag)) {
            console.log(`Tag '${tag}' already exists on contact ${contactId}`);
            return { action: 'already_tagged' };
        }
        
        // Add new tag
        const updatedTags = [...existingTags, tag];
        
        const updateUrl = `${GHL_API_URL}/contacts/${contactId}`;
        await axios.put(updateUrl, {
            tags: updatedTags
        }, { headers: headers });
        
        console.log(`✅ Added '${tag}' tag to contact ${contactId}`);
        return { action: 'tagged' };
        
    } catch (error) {
        console.error(`Error adding tag to contact ${contactId}:`, error.message);
        throw error;
    }
}

/**
 * Fetch a single member's details from ABC by member ID
 * @param {string} clubNumber - The club number
 * @param {string} memberId - The member ID
 * @returns {Promise<Object>} Member object
 */
async function fetchMemberByIdFromABC(clubNumber, memberId) {
    try {
        console.log(`\n=== Fetching Member ${memberId} ===`);
        
        // METHOD 1: Try direct member endpoint
        console.log(`Method 1: Direct endpoint /members/${memberId}`);
        try {
            const directUrl = `${ABC_API_URL}/${clubNumber}/members/${memberId}`;
            const directResponse = await axios.get(directUrl, {
                headers: {
                    'accept': 'application/json',
                    'app_id': ABC_APP_ID,
                    'app_key': ABC_APP_KEY
                }
            });
            
            console.log(`Direct endpoint response status: ${directResponse.status}`);
            
            // Check different response formats
            let member = null;
            if (directResponse.data.member) {
                member = directResponse.data.member;
            } else if (directResponse.data.members && directResponse.data.members.length > 0) {
                member = directResponse.data.members[0];
            } else if (directResponse.data.memberId) {
                member = directResponse.data;
            }
            
            if (member && member.memberId) {
                console.log(`✅ SUCCESS via direct endpoint`);
                console.log(`   Member: ${member.personal?.firstName} ${member.personal?.lastName}`);
                console.log(`   Email: ${member.personal?.email}`);
                console.log(`   MemberId match: ${member.memberId === memberId}`);
                return member;
            }
        } catch (directError) {
            console.log(`❌ Direct endpoint failed: ${directError.response?.status || directError.message}`);
        }
        
        // METHOD 2: Try query parameter
        console.log(`Method 2: Query parameter ?memberId=${memberId}`);
        const queryUrl = `${ABC_API_URL}/${clubNumber}/members`;
        const queryResponse = await axios.get(queryUrl, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            },
            params: {
                memberId: memberId
            }
        });
        
        const members = queryResponse.data.members || [];
        console.log(`Query returned ${members.length} members`);
        
        if (members.length > 0) {
            // Log first 3 memberIds to see what we got
            console.log(`Sample memberIds returned:`);
            members.slice(0, 3).forEach((m, i) => {
                console.log(`  ${i + 1}. ${m.memberId} - ${m.personal?.firstName} ${m.personal?.lastName}`);
            });
            
            // Try exact match
            const exactMatch = members.find(m => m.memberId === memberId);
            if (exactMatch) {
                console.log(`✅ SUCCESS via exact match`);
                console.log(`   Member: ${exactMatch.personal?.firstName} ${exactMatch.personal?.lastName}`);
                console.log(`   Email: ${exactMatch.personal?.email}`);
                return exactMatch;
            }
            
            // If only one result, use it
            if (members.length === 1) {
                console.log(`⚠️ No exact match, but only 1 result - using it`);
                console.log(`   Looking for: ${memberId}`);
                console.log(`   Got: ${members[0].memberId}`);
                console.log(`   Member: ${members[0].personal?.firstName} ${members[0].personal?.lastName}`);
                return members[0];
            }
        }
        
        throw new Error(`Member ${memberId} not found via any method`);
        
    } catch (error) {
        console.error(`❌ FAILED to fetch member ${memberId}`);
        console.error(`Error: ${error.message}`);
        throw error;
    }
}

/**
 * Add or update a contact in GoHighLevel
 * @param {Object} member - Member data from ABC
 * @param {string} customTag - Optional custom tag to add (default: 'sale')
 * @param {string} serviceEmployee - Optional service employee name for PT clients
 * @returns {Promise<Object>} GHL response
 */
async function syncContactToGHL(member, customTag = 'sale', serviceEmployee = null) {
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
            tags: [customTag], // Add custom tag
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
                { key: 'member_sign_date', value: agreement.signDate || '' },
                { key: 'next_billing_date', value: agreement.nextBillingDate || '' },
                { key: 'is_past_due', value: agreement.isPastDue || '' },
                { key: 'total_check_in_count', value: personal.totalCheckInCount || '' },
                { key: 'last_check_in', value: personal.lastCheckInTimestamp || '' },
                ...(serviceEmployee ? [{ key: 'service_employee', value: serviceEmployee }] : [])
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
                // First, get existing contact to preserve tags
                const getUrl = `${GHL_API_URL}/contacts/${existingContactId}`;
                const existingContact = await axios.get(getUrl, { headers: headers });
                
                // Get existing tags and add custom tag if not present
                let existingTags = existingContact.data?.contact?.tags || [];
                if (!existingTags.includes(customTag)) {
                    existingTags.push(customTag);
                }
                
                const updateData = { ...contactData };
                delete updateData.locationId; // locationId not allowed in update
                updateData.tags = existingTags; // Use combined tags
                
                const updateUrl = `${GHL_API_URL}/contacts/${existingContactId}`;
                const response = await axios.put(updateUrl, updateData, { headers: headers });
                console.log(`✅ Updated contact in GHL: ${contactData.email} (added '${customTag}' tag)`);
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
                console.log(`✅ Created contact in GHL: ${contactData.email} (with '${customTag}' tag)`);
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
                            
                            // Get existing tags
                            let existingTags = foundContact.tags || [];
                            if (!existingTags.includes(customTag)) {
                                existingTags.push(customTag);
                            }
                            
                            const updateData = { ...contactData };
                            delete updateData.locationId; // Remove for update
                            updateData.tags = existingTags; // Use combined tags
                            
                            const updateUrl = `${GHL_API_URL}/contacts/${foundContact.id}`;
                            const response = await axios.put(updateUrl, updateData, { headers: headers });
                            console.log(`✅ Updated existing duplicate: ${contactData.email} (added '${customTag}' tag)`);
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

/**
 * Add tag to existing contact in GHL (for recurring services)
 * @param {string} memberEmail - Email of the member
 * @param {string} customTag - Tag to add
 * @returns {Promise<Object>} GHL response
 */
async function addTagToContact(memberEmail, customTag) {
    try {
        const headers = {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        
        // Search for contact by email
        const searchResponse = await axios.get(`${GHL_API_URL}/contacts/`, {
            headers: headers,
            params: { 
                locationId: GHL_LOCATION_ID,
                query: memberEmail
            }
        });
        
        if (!searchResponse.data?.contacts?.length) {
            console.log(`⚠️ Contact not found in GHL: ${memberEmail}`);
            return { action: 'not_found', email: memberEmail };
        }
        
        // Find exact email match
        const exactMatch = searchResponse.data.contacts.find(
            c => c.email && c.email.toLowerCase() === memberEmail.toLowerCase()
        );
        
        if (!exactMatch) {
            console.log(`⚠️ No exact match for email: ${memberEmail}`);
            return { action: 'not_found', email: memberEmail };
        }
        
        // Get existing tags
        let existingTags = exactMatch.tags || [];
        
        // Check if tag already exists
        if (existingTags.includes(customTag)) {
            console.log(`Tag '${customTag}' already exists for ${memberEmail}`);
            return { action: 'already_tagged', contact: exactMatch };
        }
        
        // Add new tag
        existingTags.push(customTag);
        
        // Update contact with new tag
        const updateUrl = `${GHL_API_URL}/contacts/${exactMatch.id}`;
        const response = await axios.put(updateUrl, {
            tags: existingTags
        }, { headers: headers });
        
        console.log(`✅ Added '${customTag}' tag to contact: ${memberEmail}`);
        return { action: 'tagged', contact: response.data };
        
    } catch (error) {
        console.error(`Error adding tag to ${memberEmail}:`, error.message);
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
            autoTagging: 'Adds appropriate tags to all synced contacts',
            customFields: 'Syncs 15+ fields including membership type and sign date',
            cancelledTracking: 'Tracks members who cancel',
            ptTracking: 'Tracks PT service activations and deactivations'
        },
        endpoints: {
            'GET /': 'This message',
            'GET /api/health': 'Health check',
            'GET /api/debug-abc': 'Debug - see raw ABC member data',
            'POST /api/sync': 'Sync new members (tag: sale)',
            'POST /api/sync-cancelled': 'Sync cancelled members (tag: cancelled / past member)',
            'POST /api/sync-pt-new': 'Sync new PT services (tag: pt current)',
            'POST /api/sync-pt-deactivated': 'Sync deactivated PT (tag: ex pt)',
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

// Debug endpoint - see raw ABC member data to understand field values
app.get('/api/debug-abc', async (req, res) => {
    const { clubNumber = '30935', limit = 10 } = req.query;
    
    try {
        const url = `${ABC_API_URL}/${clubNumber}/members`;
        
        console.log('Fetching sample members from ABC for debugging...');
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            },
            params: {
                size: limit
            }
        });
        
        const members = response.data.members || [];
        
        // Return key fields so we can see what values ABC uses
        res.json({
            success: true,
            totalReturned: members.length,
            members: members.map(m => ({
                memberId: m.memberId,
                name: `${m.personal?.firstName} ${m.personal?.lastName}`,
                email: m.personal?.email,
                // Status fields - let's see what values these have
                isActive: m.personal?.isActive,
                memberStatus: m.personal?.memberStatus,
                memberStatusDate: m.personal?.memberStatusDate,
                memberStatusReason: m.personal?.memberStatusReason,
                joinStatus: m.personal?.joinStatus,
                // Dates
                convertedDate: m.agreement?.convertedDate,
                signDate: m.agreement?.signDate,
                membershipType: m.agreement?.membershipType
            }))
        });
        
    } catch (error) {
        console.error('Debug endpoint error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
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
// Sync cancelled members - automatically syncs members who cancelled yesterday
app.post('/api/sync-cancelled', async (req, res) => {
    let { clubNumber, startDate, endDate } = req.body;
    
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY || !GHL_API_KEY || !GHL_LOCATION_ID) {
        return res.status(500).json({
            error: 'API keys not configured'
        });
    }
    
    // Default club if not specified
    if (!clubNumber) {
        clubNumber = '30935';
    }
    
    // Calculate yesterday if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`Auto-set to yesterday: ${startDate}`);
    }
    
    try {
        console.log(`\n=== Syncing Cancelled Members ===`);
        
        const results = {
            type: 'cancelled_members',
            clubNumber: clubNumber,
            dateRange: `${startDate} to ${endDate}`,
            totalMembers: 0,
            tagged: 0,
            alreadyTagged: 0,
            notFound: 0,
            errors: 0,
            members: []
        };
        
        // Fetch cancelled members
        const members = await fetchCancelledMembersFromABC(clubNumber, startDate, endDate);
        results.totalMembers = members.length;
        
        console.log(`Found ${members.length} cancelled members`);
        
        // Tag each cancelled member in GHL
        for (const member of members) {
            try {
                const personal = member.personal || {};
                const email = personal.email;
                
                if (!email) {
                    console.log(`⚠️ Skipping member without email: ${member.memberId}`);
                    results.notFound++;
                    continue;
                }
                
                // Add 'cancelled / past member' tag
                const result = await addTagToContact(email, 'cancelled / past member');
                
                if (result.action === 'tagged') {
                    results.tagged++;
                } else if (result.action === 'already_tagged') {
                    results.alreadyTagged++;
                } else if (result.action === 'not_found') {
                    results.notFound++;
                }
                
                results.members.push({
                    email: email,
                    name: `${personal.firstName} ${personal.lastName}`,
                    cancelDate: personal.memberStatusDate,
                    cancelReason: personal.memberStatusReason,
                    action: result.action
                });
                
            } catch (memberError) {
                results.errors++;
                console.error(`Error processing member: ${memberError.message}`);
            }
        }
        
        console.log(`\n=== Cancelled Members Sync Complete ===`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Already Tagged: ${results.alreadyTagged}`);
        console.log(`Not Found: ${results.notFound}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Cancelled members sync completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Cancelled sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync new PT services - automatically syncs PT services sold yesterday
app.post('/api/sync-pt-new', async (req, res) => {
    let { clubNumber, startDate, endDate } = req.body;
    
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY || !GHL_API_KEY || !GHL_LOCATION_ID) {
        return res.status(500).json({
            error: 'API keys not configured'
        });
    }
    
    // Default club if not specified
    if (!clubNumber) {
        clubNumber = '30935';
    }
    
    // Calculate yesterday if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`Auto-set to yesterday: ${startDate}`);
    }
    
    try {
        console.log(`\n=== Syncing New PT Services ===`);
        
        const results = {
            type: 'new_pt_services',
            clubNumber: clubNumber,
            dateRange: `${startDate} to ${endDate}`,
            totalServices: 0,
            created: 0,
            updated: 0,
            tagged: 0,
            errors: 0,
            services: []
        };
        
        // Fetch new recurring services (sold yesterday)
        const services = await fetchRecurringServicesFromABC(clubNumber, startDate, endDate, 'Active', 'sale');
        results.totalServices = services.length;
        
        console.log(`Found ${services.length} new PT services`);
        
        // Fetch member details from ABC and create/update in GHL
        for (const service of services) {
            try {
                console.log(`\n━━━ Processing PT Service ━━━`);
                console.log(`Service: ${service.serviceItem}`);
                console.log(`Member: ${service.memberFirstName} ${service.memberLastName}`);
                console.log(`MemberId: ${service.memberId}`);
                console.log(`Sale Date: ${service.recurringServiceDates?.saleDate}`);
                
                // Fetch full member details from ABC
                const member = await fetchMemberByIdFromABC(clubNumber, service.memberId);
                
                if (!member || !member.personal?.email) {
                    console.log(`⚠️ Member has no email, skipping`);
                    results.errors++;
                    results.services.push({
                        memberId: service.memberId,
                        memberName: `${service.memberFirstName} ${service.memberLastName}`,
                        serviceItem: service.serviceItem,
                        saleDate: service.recurringServiceDates?.saleDate,
                        action: 'no_email'
                    });
                    continue;
                }
                
                console.log(`Creating/updating contact in GHL...`);
                
                // Build service employee full name
                const serviceEmployee = `${service.serviceEmployeeFirstName || ''} ${service.serviceEmployeeLastName || ''}`.trim();
                console.log(`Service Employee: ${serviceEmployee}`);
                
                // Create/update contact in GHL with 'pt current' tag and service employee
                const result = await syncContactToGHL(member, 'pt current', serviceEmployee || null);
                
                if (result.action === 'created') {
                    results.created++;
                } else if (result.action === 'updated') {
                    results.updated++;
                }
                results.tagged++;
                
                results.services.push({
                    memberId: service.memberId,
                    memberName: `${member.personal.firstName} ${member.personal.lastName}`,
                    email: member.personal.email,
                    serviceItem: service.serviceItem,
                    saleDate: service.recurringServiceDates?.saleDate,
                    salesPerson: `${service.salesPersonFirstName} ${service.salesPersonLastName}`,
                    action: result.action
                });
                
                console.log(`✅ Completed: ${result.action}`);
                
            } catch (serviceError) {
                results.errors++;
                console.error(`❌ Error: ${serviceError.message}`);
                results.services.push({
                    memberId: service.memberId,
                    memberName: `${service.memberFirstName} ${service.memberLastName}`,
                    error: serviceError.message
                });
            }
        }
        
        console.log(`\n=== New PT Services Sync Complete ===`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'New PT services sync completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('PT sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync deactivated PT services - automatically syncs PT services deactivated yesterday
app.post('/api/sync-pt-deactivated', async (req, res) => {
    let { clubNumber, startDate, endDate } = req.body;
    
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY || !GHL_API_KEY || !GHL_LOCATION_ID) {
        return res.status(500).json({
            error: 'API keys not configured'
        });
    }
    
    // Default club if not specified
    if (!clubNumber) {
        clubNumber = '30935';
    }
    
    // Calculate yesterday if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`Auto-set to yesterday: ${startDate}`);
    }
    
    try {
        console.log(`\n=== Syncing Deactivated PT Services ===`);
        
        const results = {
            type: 'deactivated_pt_services',
            clubNumber: clubNumber,
            dateRange: `${startDate} to ${endDate}`,
            totalServices: 0,
            created: 0,
            updated: 0,
            tagged: 0,
            errors: 0,
            services: []
        };
        
        // Fetch deactivated recurring services
        const services = await fetchRecurringServicesFromABC(clubNumber, startDate, endDate, 'Inactive', 'inactive');
        
        // Filter to only those deactivated in date range
        const deactivatedServices = services.filter(service => {
            const inactiveDate = service.recurringServiceDates?.inactiveDate;
            if (!inactiveDate) return false;
            
            const date = inactiveDate.split('T')[0];
            return date >= startDate && date <= endDate;
        });
        
        results.totalServices = deactivatedServices.length;
        
        console.log(`Found ${deactivatedServices.length} deactivated PT services`);
        
        // Fetch member details from ABC and create/update in GHL
        for (const service of deactivatedServices) {
            try {
                console.log(`\n━━━ Processing Deactivated PT Service ━━━`);
                console.log(`Service: ${service.serviceItem}`);
                console.log(`Member: ${service.memberFirstName} ${service.memberLastName}`);
                console.log(`MemberId: ${service.memberId}`);
                console.log(`Inactive Date: ${service.recurringServiceDates?.inactiveDate}`);
                
                // Fetch full member details from ABC
                const member = await fetchMemberByIdFromABC(clubNumber, service.memberId);
                
                if (!member || !member.personal?.email) {
                    console.log(`⚠️ Member has no email, skipping`);
                    results.errors++;
                    results.services.push({
                        memberId: service.memberId,
                        memberName: `${service.memberFirstName} ${service.memberLastName}`,
                        serviceItem: service.serviceItem,
                        inactiveDate: service.recurringServiceDates?.inactiveDate,
                        action: 'no_email'
                    });
                    continue;
                }
                
                console.log(`Creating/updating contact in GHL...`);
                
                // Build service employee full name
                const serviceEmployee = `${service.serviceEmployeeFirstName || ''} ${service.serviceEmployeeLastName || ''}`.trim();
                console.log(`Service Employee: ${serviceEmployee}`);
                
                // Create/update contact in GHL with 'ex pt' tag and service employee
                const result = await syncContactToGHL(member, 'ex pt', serviceEmployee || null);
                
                if (result.action === 'created') {
                    results.created++;
                } else if (result.action === 'updated') {
                    results.updated++;
                }
                results.tagged++;
                
                results.services.push({
                    memberId: service.memberId,
                    memberName: `${member.personal.firstName} ${member.personal.lastName}`,
                    email: member.personal.email,
                    serviceItem: service.serviceItem,
                    inactiveDate: service.recurringServiceDates?.inactiveDate,
                    deactivateReason: service.recurringServiceDates?.deactivateReason,
                    action: result.action
                });
                
                console.log(`✅ Completed: ${result.action}`);
                
            } catch (serviceError) {
                results.errors++;
                console.error(`❌ Error: ${serviceError.message}`);
                results.services.push({
                    memberId: service.memberId,
                    memberName: `${service.memberFirstName} ${service.memberLastName}`,
                    error: serviceError.message
                });
            }
        }
        
        console.log(`\n=== Deactivated PT Services Sync Complete ===`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Deactivated PT services sync completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Deactivated PT sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
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
