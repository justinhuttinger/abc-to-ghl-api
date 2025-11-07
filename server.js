const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Environment variables (you'll set these in Render)
const ABC_API_URL = process.env.ABC_API_URL || 'https://api.abcfinancial.com/rest'; // Replace with actual ABC API base URL
const ABC_API_KEY = process.env.ABC_API_KEY;
const GHL_API_URL = process.env.GHL_API_URL || 'https://rest.gohighlevel.com/v1';
const GHL_API_KEY = process.env.GHL_API_KEY;

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
        
        // Build query parameters
        const params = {};
        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;
        
        console.log(`Fetching members from ABC: ${url}`, params);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${ABC_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: params
        });
        
        console.log(`Successfully fetched ${response.data.length || 0} members from ABC`);
        return response.data;
        
    } catch (error) {
        console.error('Error fetching from ABC:', error.message);
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
        const contactData = {
            firstName: member.firstName || member.first_name,
            lastName: member.lastName || member.last_name,
            email: member.email,
            phone: member.phone || member.phoneNumber,
            // Add custom fields as needed
            customFields: {
                abc_member_id: member.id || member.memberId,
                abc_club_number: member.clubNumber,
                membership_type: member.membershipType,
                join_date: member.joinDate,
                status: member.status
            }
        };
        
        // First, try to find if contact already exists in GHL
        const searchUrl = `${GHL_API_URL}/contacts/lookup`;
        let contactExists = false;
        let existingContactId = null;
        
        try {
            const searchResponse = await axios.get(searchUrl, {
                headers: {
                    'Authorization': `Bearer ${GHL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                params: { email: contactData.email }
            });
            
            if (searchResponse.data && searchResponse.data.contact) {
                contactExists = true;
                existingContactId = searchResponse.data.contact.id;
            }
        } catch (searchError) {
            // Contact doesn't exist, we'll create it
            console.log(`Contact not found in GHL, will create new: ${contactData.email}`);
        }
        
        // Update or Create contact
        if (contactExists) {
            // UPDATE existing contact
            const updateUrl = `${GHL_API_URL}/contacts/${existingContactId}`;
            const response = await axios.put(updateUrl, contactData, {
                headers: {
                    'Authorization': `Bearer ${GHL_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`Updated contact in GHL: ${contactData.email}`);
            return { action: 'updated', contact: response.data };
            
        } else {
            // CREATE new contact
            const createUrl = `${GHL_API_URL}/contacts`;
            const response = await axios.post(createUrl, contactData, {
                headers: {
                    'Authorization': `Bearer ${GHL_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`Created contact in GHL: ${contactData.email}`);
            return { action: 'created', contact: response.data };
        }
        
    } catch (error) {
        console.error('Error syncing to GHL:', error.message);
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
        endpoints: {
            'GET /': 'This message',
            'GET /api/health': 'Health check',
            'POST /api/sync': 'Sync members from ABC to GHL',
            'POST /api/sync/:clubNumber': 'Sync members for specific club',
            'GET /api/test-abc': 'Test ABC API connection',
            'GET /api/test-ghl': 'Test GHL API connection'
        },
        configuration: {
            abc_api: ABC_API_KEY ? 'configured' : 'NOT CONFIGURED',
            ghl_api: GHL_API_KEY ? 'configured' : 'NOT CONFIGURED'
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apis: {
            abc: ABC_API_KEY ? 'configured' : 'missing',
            ghl: GHL_API_KEY ? 'configured' : 'missing'
        }
    });
});

// Test ABC API connection
app.get('/api/test-abc', async (req, res) => {
    const { clubNumber } = req.query;
    
    if (!ABC_API_KEY) {
        return res.status(500).json({ error: 'ABC_API_KEY not configured' });
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

// Test GHL API connection
app.get('/api/test-ghl', async (req, res) => {
    if (!GHL_API_KEY) {
        return res.status(500).json({ error: 'GHL_API_KEY not configured' });
    }
    
    try {
        const response = await axios.get(`${GHL_API_URL}/contacts`, {
            headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            params: { limit: 1 }
        });
        
        res.json({
            success: true,
            message: 'GHL API connection successful',
            contactCount: response.data.contacts?.length || 0
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Main sync endpoint with parameters
app.post('/api/sync', async (req, res) => {
    const { clubNumber, clubNumbers, startDate, endDate } = req.body;
    
    // Validate required configuration
    if (!ABC_API_KEY || !GHL_API_KEY) {
        return res.status(500).json({
            error: 'API keys not configured',
            abc: ABC_API_KEY ? 'ok' : 'missing',
            ghl: GHL_API_KEY ? 'ok' : 'missing'
        });
    }
    
    // Validate club number(s)
    if (!clubNumber && !clubNumbers) {
        return res.status(400).json({
            error: 'clubNumber or clubNumbers required',
            example: {
                clubNumber: '12345',
                startDate: '2024-01-01',
                endDate: '2024-12-31'
            }
        });
    }
    
    try {
        // Handle multiple clubs or single club
        const clubs = clubNumbers || [clubNumber];
        const results = {
            totalClubs: clubs.length,
            totalMembers: 0,
            created: 0,
            updated: 0,
            errors: 0,
            clubs: []
        };
        
        // Process each club
        for (const club of clubs) {
            console.log(`\n=== Processing Club: ${club} ===`);
            const clubResult = {
                clubNumber: club,
                members: 0,
                created: 0,
                updated: 0,
                errors: [],
                startTime: new Date().toISOString()
            };
            
            try {
                // Fetch members from ABC
                const members = await fetchMembersFromABC(club, startDate, endDate);
                clubResult.members = members.length || 0;
                results.totalMembers += clubResult.members;
                
                // Sync each member to GHL
                for (const member of members) {
                    try {
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
                            member: member.email || member.id,
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
    console.log(`   ABC API: ${ABC_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   GHL API: ${GHL_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`\n📝 Ready to sync members!\n`);
});
