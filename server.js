const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ============================================
// CONFIGURATION - Read from Environment Variables
// ============================================
const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_CLUB_NUMBER = process.env.ABC_CLUB_NUMBER || '30935';

const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

// Membership types to EXCLUDE
const EXCLUDED_MEMBERSHIP_TYPES = ['NON-MEMBER', 'Employee'];

// Validate required environment variables
if (!ABC_APP_ID) {
    console.error('ERROR: ABC_APP_ID environment variable is required');
}
if (!GHL_API_KEY) {
    console.error('ERROR: GHL_API_KEY environment variable is required');
}
if (!GHL_LOCATION_ID) {
    console.error('ERROR: GHL_LOCATION_ID environment variable is required');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Get yesterday's date
function getYesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
}

// Format date for API
function formatDate(dateString) {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

// ============================================
// DEBUG/TEST ENDPOINTS
// ============================================

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'ABC to GHL Sync Server',
        status: 'running',
        version: '2.0 - Debug Edition',
        endpoints: {
            'POST /api/sync': 'Sync yesterday\'s members (auto)',
            'POST /api/sync-date': 'Sync specific date range',
            'POST /api/test-abc': 'Test ABC API connection',
            'POST /api/test-ghl': 'Test GHL API connection',
            'GET /api/health': 'Health check'
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config: {
            abcBaseUrl: ABC_BASE_URL,
            abcAppId: ABC_APP_ID,
            abcClubNumber: ABC_CLUB_NUMBER,
            ghlLocationId: GHL_LOCATION_ID,
            excludedTypes: EXCLUDED_MEMBERSHIP_TYPES
        }
    });
});

// Test ABC API - see what members we're getting
app.post('/api/test-abc', async (req, res) => {
    try {
        const { clubNumber, startDate, endDate } = req.body;
        const club = clubNumber || ABC_CLUB_NUMBER;
        const start = startDate || getYesterday();
        const end = endDate || getYesterday();

        console.log(`Testing ABC API for club ${club}, dates ${start} to ${end}`);

        const abcUrl = `${ABC_BASE_URL}/members/checkIns`;
        const params = {
            appId: ABC_APP_ID,
            clubNumber: club,
            startDate: formatDate(start),
            endDate: formatDate(end)
        };

        console.log('ABC Request:', abcUrl, params);

        const response = await axios.get(abcUrl, { params });
        const members = response.data || [];

        console.log(`ABC Response: ${members.length} members found`);

        // Categorize members
        const included = members.filter(m => !EXCLUDED_MEMBERSHIP_TYPES.includes(m.membershipType));
        const excluded = members.filter(m => EXCLUDED_MEMBERSHIP_TYPES.includes(m.membershipType));

        res.json({
            success: true,
            dateRange: {
                start: formatDate(start),
                end: formatDate(end)
            },
            total: members.length,
            included: included.length,
            excluded: excluded.length,
            members: members.map(m => ({
                name: `${m.firstName} ${m.lastName}`,
                email: m.email,
                phone: m.homePhone,
                membershipType: m.membershipType,
                willBeAdded: !EXCLUDED_MEMBERSHIP_TYPES.includes(m.membershipType)
            })),
            rawResponse: members // Full data for debugging
        });

    } catch (error) {
        console.error('ABC Test Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'ABC API Test Failed',
            message: error.message,
            details: error.response?.data || null
        });
    }
});

// Test GHL API - check if we can connect
app.post('/api/test-ghl', async (req, res) => {
    try {
        const testContact = {
            firstName: 'Test',
            lastName: 'Contact',
            email: 'test@example.com',
            phone: '+15555555555',
            tags: ['test', 'sale']
        };

        console.log('Testing GHL API with test contact');

        // Try to search for existing contact first
        const searchUrl = `${GHL_BASE_URL}/contacts/search/duplicate`;
        const searchResponse = await axios.post(
            searchUrl,
            {
                locationId: GHL_LOCATION_ID,
                email: testContact.email
            },
            {
                headers: {
                    'Authorization': `Bearer ${GHL_API_KEY}`,
                    'Version': '2021-07-28',
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            message: 'GHL API connection successful!',
            config: {
                locationId: GHL_LOCATION_ID,
                baseUrl: GHL_BASE_URL
            },
            testResult: {
                contactFound: searchResponse.data.contact ? true : false,
                response: searchResponse.data
            }
        });

    } catch (error) {
        console.error('GHL Test Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'GHL API Test Failed',
            message: error.message,
            details: error.response?.data || null,
            hint: 'Check if your GHL API key and Location ID are correct'
        });
    }
});

// ============================================
// MAIN SYNC ENDPOINTS
// ============================================

// Sync yesterday's members automatically
app.post('/api/sync', async (req, res) => {
    try {
        const { clubNumber } = req.body;
        const club = clubNumber || ABC_CLUB_NUMBER;
        const yesterday = getYesterday();

        console.log(`\n=== SYNC STARTED ===`);
        console.log(`Club: ${club}`);
        console.log(`Date: ${yesterday} (Yesterday)`);
        console.log(`Time: ${new Date().toISOString()}`);

        // Get members from ABC
        const abcUrl = `${ABC_BASE_URL}/members/checkIns`;
        const params = {
            appId: ABC_APP_ID,
            clubNumber: club,
            startDate: formatDate(yesterday),
            endDate: formatDate(yesterday)
        };

        console.log('Fetching from ABC:', params);
        const abcResponse = await axios.get(abcUrl, { params });
        const allMembers = abcResponse.data || [];

        console.log(`ABC returned ${allMembers.length} total members`);

        // Filter out excluded membership types
        const members = allMembers.filter(member => 
            !EXCLUDED_MEMBERSHIP_TYPES.includes(member.membershipType)
        );

        const skippedMembers = allMembers.filter(member => 
            EXCLUDED_MEMBERSHIP_TYPES.includes(member.membershipType)
        ).map(m => ({
            name: `${m.firstName} ${m.lastName}`,
            membershipType: m.membershipType,
            reason: 'Excluded membership type'
        }));

        console.log(`Filtered to ${members.length} members (skipped ${skippedMembers.length})`);

        if (members.length === 0) {
            return res.json({
                success: true,
                message: 'No members to sync',
                results: {
                    date: yesterday,
                    totalMembers: allMembers.length,
                    created: 0,
                    updated: 0,
                    skipped: skippedMembers.length,
                    skippedMembers: skippedMembers
                }
            });
        }

        // Sync to GHL
        let created = 0;
        let updated = 0;
        const errors = [];

        for (const member of members) {
            try {
                console.log(`Processing: ${member.firstName} ${member.lastName} (${member.membershipType})`);

                // Check if contact exists
                const searchUrl = `${GHL_BASE_URL}/contacts/search/duplicate`;
                const searchResponse = await axios.post(
                    searchUrl,
                    {
                        locationId: GHL_LOCATION_ID,
                        email: member.email
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${GHL_API_KEY}`,
                            'Version': '2021-07-28',
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const existingContact = searchResponse.data.contact;
                const contactData = {
                    firstName: member.firstName,
                    lastName: member.lastName,
                    email: member.email,
                    phone: member.homePhone,
                    tags: ['sale']
                };

                if (existingContact) {
                    // Update existing contact
                    console.log(`  → Updating existing contact ID: ${existingContact.id}`);
                    await axios.put(
                        `${GHL_BASE_URL}/contacts/${existingContact.id}`,
                        contactData,
                        {
                            headers: {
                                'Authorization': `Bearer ${GHL_API_KEY}`,
                                'Version': '2021-07-28',
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    updated++;
                } else {
                    // Create new contact
                    console.log(`  → Creating new contact`);
                    contactData.locationId = GHL_LOCATION_ID;
                    await axios.post(
                        `${GHL_BASE_URL}/contacts/`,
                        contactData,
                        {
                            headers: {
                                'Authorization': `Bearer ${GHL_API_KEY}`,
                                'Version': '2021-07-28',
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    created++;
                }

            } catch (error) {
                console.error(`  ✗ Error processing ${member.firstName} ${member.lastName}:`, error.message);
                errors.push({
                    member: `${member.firstName} ${member.lastName}`,
                    error: error.message
                });
            }
        }

        console.log(`\n=== SYNC COMPLETED ===`);
        console.log(`Created: ${created}, Updated: ${updated}, Skipped: ${skippedMembers.length}`);

        res.json({
            success: true,
            results: {
                date: yesterday,
                totalMembers: allMembers.length,
                created: created,
                updated: updated,
                skipped: skippedMembers.length,
                skippedMembers: skippedMembers,
                errors: errors.length > 0 ? errors : undefined
            }
        });

    } catch (error) {
        console.error('Sync Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'Sync failed',
            message: error.message,
            details: error.response?.data || null
        });
    }
});

// Sync specific date range
app.post('/api/sync-date', async (req, res) => {
    try {
        const { clubNumber, startDate, endDate } = req.body;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                message: 'startDate and endDate are required (format: YYYY-MM-DD)'
            });
        }

        const club = clubNumber || ABC_CLUB_NUMBER;

        console.log(`\n=== SYNC STARTED ===`);
        console.log(`Club: ${club}`);
        console.log(`Date Range: ${startDate} to ${endDate}`);
        console.log(`Time: ${new Date().toISOString()}`);

        // Get members from ABC
        const abcUrl = `${ABC_BASE_URL}/members/checkIns`;
        const params = {
            appId: ABC_APP_ID,
            clubNumber: club,
            startDate: formatDate(startDate),
            endDate: formatDate(endDate)
        };

        console.log('Fetching from ABC:', params);
        const abcResponse = await axios.get(abcUrl, { params });
        const allMembers = abcResponse.data || [];

        console.log(`ABC returned ${allMembers.length} total members`);

        // Filter out excluded membership types
        const members = allMembers.filter(member => 
            !EXCLUDED_MEMBERSHIP_TYPES.includes(member.membershipType)
        );

        const skippedMembers = allMembers.filter(member => 
            EXCLUDED_MEMBERSHIP_TYPES.includes(member.membershipType)
        ).map(m => ({
            name: `${m.firstName} ${m.lastName}`,
            membershipType: m.membershipType,
            reason: 'Excluded membership type'
        }));

        console.log(`Filtered to ${members.length} members (skipped ${skippedMembers.length})`);

        if (members.length === 0) {
            return res.json({
                success: true,
                message: 'No members to sync',
                results: {
                    dateRange: { startDate, endDate },
                    totalMembers: allMembers.length,
                    created: 0,
                    updated: 0,
                    skipped: skippedMembers.length,
                    skippedMembers: skippedMembers
                }
            });
        }

        // Sync to GHL
        let created = 0;
        let updated = 0;
        const errors = [];

        for (const member of members) {
            try {
                console.log(`Processing: ${member.firstName} ${member.lastName} (${member.membershipType})`);

                // Check if contact exists
                const searchUrl = `${GHL_BASE_URL}/contacts/search/duplicate`;
                const searchResponse = await axios.post(
                    searchUrl,
                    {
                        locationId: GHL_LOCATION_ID,
                        email: member.email
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${GHL_API_KEY}`,
                            'Version': '2021-07-28',
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const existingContact = searchResponse.data.contact;
                const contactData = {
                    firstName: member.firstName,
                    lastName: member.lastName,
                    email: member.email,
                    phone: member.homePhone,
                    tags: ['sale']
                };

                if (existingContact) {
                    // Update existing contact
                    console.log(`  → Updating existing contact ID: ${existingContact.id}`);
                    await axios.put(
                        `${GHL_BASE_URL}/contacts/${existingContact.id}`,
                        contactData,
                        {
                            headers: {
                                'Authorization': `Bearer ${GHL_API_KEY}`,
                                'Version': '2021-07-28',
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    updated++;
                } else {
                    // Create new contact
                    console.log(`  → Creating new contact`);
                    contactData.locationId = GHL_LOCATION_ID;
                    await axios.post(
                        `${GHL_BASE_URL}/contacts/`,
                        contactData,
                        {
                            headers: {
                                'Authorization': `Bearer ${GHL_API_KEY}`,
                                'Version': '2021-07-28',
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    created++;
                }

            } catch (error) {
                console.error(`  ✗ Error processing ${member.firstName} ${member.lastName}:`, error.message);
                errors.push({
                    member: `${member.firstName} ${member.lastName}`,
                    error: error.message
                });
            }
        }

        console.log(`\n=== SYNC COMPLETED ===`);
        console.log(`Created: ${created}, Updated: ${updated}, Skipped: ${skippedMembers.length}`);

        res.json({
            success: true,
            results: {
                dateRange: { startDate, endDate },
                totalMembers: allMembers.length,
                created: created,
                updated: updated,
                skipped: skippedMembers.length,
                skippedMembers: skippedMembers,
                errors: errors.length > 0 ? errors : undefined
            }
        });

    } catch (error) {
        console.error('Sync Error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: 'Sync failed',
            message: error.message,
            details: error.response?.data || null
        });
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log(`\n🚀 ABC to GHL Sync Server running on port ${PORT}`);
    console.log(`📍 Endpoints:`);
    console.log(`   GET  /                    - Server info`);
    console.log(`   GET  /api/health          - Health check`);
    console.log(`   POST /api/test-abc        - Test ABC API`);
    console.log(`   POST /api/test-ghl        - Test GHL API`);
    console.log(`   POST /api/sync            - Sync yesterday's members`);
    console.log(`   POST /api/sync-date       - Sync specific date range`);
    console.log(`\n✨ Debug edition with enhanced logging\n`);
});
