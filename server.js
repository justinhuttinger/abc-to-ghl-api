const express = require('express');
const axios = require('axios');
const fs = require('fs');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Environment variables (you'll set these in Render)
const ABC_API_URL = process.env.ABC_API_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const GHL_API_URL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';

// Email configuration
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || 'justin@wcstrength.com';

// Email configuration using SendGrid Web API
const sgMail = require('@sendgrid/mail');
let emailEnabled = false;

// For SendGrid, EMAIL_PASS should be the API key
if (EMAIL_PASS && EMAIL_PASS.startsWith('SG.')) {
    sgMail.setApiKey(EMAIL_PASS);
    emailEnabled = true;
    console.log('✅ Email notifications enabled (SendGrid Web API)');
    console.log('   Sending from:', EMAIL_USER || 'justin@wcstrength.com');
    console.log('   Sending to:', NOTIFICATION_EMAIL);
} else {
    console.log('⚠️ Email notifications disabled (SendGrid API key not found)');
    console.log('   EMAIL_PASS should start with SG.');
}

// Load clubs configuration
let clubsConfig = { clubs: [] };
try {
    const configFile = fs.readFileSync('./clubs-config.json', 'utf8');
    clubsConfig = JSON.parse(configFile);
    console.log('Loaded ' + clubsConfig.clubs.length + ' clubs from configuration');
} catch (error) {
    console.error('Failed to load clubs-config.json:', error.message);
    console.error('Server will start but syncs will fail without club configuration');
}

// Logging middleware
app.use((req, res, next) => {
    console.log(new Date().toISOString() + ' - ' + req.method + ' ' + req.path);
    next();
});

/**
 * Send email notification with sync results
 * @param {string} subject - Email subject
 * @param {Object} results - Results object from sync
 * @param {boolean} success - Whether sync was successful
 */
async function sendEmailNotification(subject, results, success = true) {
    if (!emailEnabled) {
        console.log('Email notifications disabled, skipping...');
        return;
    }
    
    try {
        let html = '<h2>' + subject + '</h2>';
        html += '<p><strong>Status:</strong> ' + (success ? '✅ SUCCESS' : '❌ FAILED') + '</p>';
        html += '<p><strong>Timestamp:</strong> ' + new Date().toISOString() + '</p>';
        html += '<hr>';
        
        if (success) {
            html += '<h3>Summary</h3><ul>';
            html += '<li><strong>Total Clubs:</strong> ' + (results.totalClubs || 'N/A') + '</li>';
            html += '<li><strong>Total Members/Services:</strong> ' + (results.totalMembers || results.totalServices || 0) + '</li>';
            html += '<li><strong>Created:</strong> ' + (results.created || 0) + '</li>';
            html += '<li><strong>Updated:</strong> ' + (results.updated || 0) + '</li>';
            html += '<li><strong>Tagged:</strong> ' + (results.tagged || 0) + '</li>';
            html += '<li><strong>Skipped:</strong> ' + (results.skipped || 0) + '</li>';
            html += '<li><strong>Errors:</strong> ' + (results.errors || 0) + '</li>';
            html += '</ul>';
        } else {
            html += '<h3>Error Details</h3>';
            html += '<p>' + (results.error || 'Unknown error occurred') + '</p>';
        }
        
        const msg = {
            to: NOTIFICATION_EMAIL,
            from: EMAIL_USER || 'justin@wcstrength.com',
            subject: subject,
            html: html
        };
        
        await sgMail.send(msg);
        console.log('📧 Email sent successfully to ' + NOTIFICATION_EMAIL);
        
    } catch (error) {
        console.error('Failed to send email:', error.message);
        if (error.response) {
            console.error('SendGrid error:', error.response.body);
        }
    }
}

async function sendMasterSyncEmail(masterResults, success = true) {
    if (!emailEnabled) {
        console.log('Email notifications disabled, skipping...');
        return;
    }
    
    try {
        let html = '<h1>🚀 Daily WCS Sync Report</h1>';
        html += '<p><strong>Status:</strong> ' + (success ? '✅ ALL SYNCS COMPLETE' : '❌ SOME SYNCS FAILED') + '</p>';
        html += '<p><strong>Start Time:</strong> ' + masterResults.startTime + '</p>';
        html += '<p><strong>End Time:</strong> ' + masterResults.endTime + '</p>';
        html += '<p><strong>Total Duration:</strong> ' + masterResults.totalDuration + '</p>';
        html += '<hr>';
        
        // 1. New Members
        if (masterResults.syncs.newMembers) {
            const sync = masterResults.syncs.newMembers;
            html += '<h2>1️⃣ New Members Sync</h2>';
            html += '<p><strong>Status:</strong> ' + (sync.success ? '✅ Success' : '❌ Failed') + '</p>';
            if (sync.success) {
                const r = sync.results;
                html += '<p><strong>Date Range:</strong> ' + r.dateRange + '</p>';
                html += '<p><strong>Overall:</strong> ' + r.totalMembers + ' total, ' + r.created + ' created, ' + r.updated + ' updated, ' + r.skipped + ' skipped, ' + r.errors + ' errors</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #4CAF50; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Members: ' + (club.members || 0) + ' | ';
                        html += 'Created: ' + (club.created || 0) + ' | ';
                        html += 'Updated: ' + (club.updated || 0) + ' | ';
                        html += 'Skipped: ' + (club.skipped || 0) + ' | ';
                        html += 'Errors: ' + (club.errors || 0);
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        // 2. Cancelled Members
        if (masterResults.syncs.cancelledMembers) {
            const sync = masterResults.syncs.cancelledMembers;
            html += '<h2>2️⃣ Cancelled Members Sync</h2>';
            html += '<p><strong>Status:</strong> ' + (sync.success ? '✅ Success' : '❌ Failed') + '</p>';
            if (sync.success) {
                const r = sync.results;
                html += '<p><strong>Date Range:</strong> ' + r.dateRange + '</p>';
                html += '<p><strong>Overall:</strong> ' + r.totalMembers + ' total, ' + r.tagged + ' tagged, ' + r.alreadyTagged + ' already tagged, ' + r.notFound + ' not found, ' + r.errors + ' errors</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #FF9800; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Members: ' + (club.totalMembers || 0) + ' | ';
                        html += 'Tagged: ' + (club.tagged || 0) + ' | ';
                        html += 'Already Tagged: ' + (club.alreadyTagged || 0) + ' | ';
                        html += 'Not Found: ' + (club.notFound || 0) + ' | ';
                        html += 'Errors: ' + (club.errors || 0);
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        // 3. Past Due Members
        if (masterResults.syncs.pastDueMembers) {
            const sync = masterResults.syncs.pastDueMembers;
            html += '<h2>3️⃣ Past Due Members Sync (3 Days)</h2>';
            html += '<p><strong>Status:</strong> ' + (sync.success ? '✅ Success' : '❌ Failed') + '</p>';
            if (sync.success) {
                const r = sync.results;
                html += '<p><strong>Overall:</strong> ' + r.totalMembers + ' members 3 days past due, ' + r.tagged + ' tagged, ' + r.notFound + ' not found, ' + r.errors + ' errors</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #F44336; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Members: ' + (club.members || 0) + ' | ';
                        html += 'Tagged: ' + (club.tagged || 0) + ' | ';
                        html += 'Not Found: ' + (club.notFound || 0) + ' | ';
                        html += 'Errors: ' + (club.errors || 0);
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        // 4. New PT Services
        if (masterResults.syncs.newPTServices) {
            const sync = masterResults.syncs.newPTServices;
            html += '<h2>4️⃣ New PT Services Sync</h2>';
            html += '<p><strong>Status:</strong> ' + (sync.success ? '✅ Success' : '❌ Failed') + '</p>';
            if (sync.success) {
                const r = sync.results;
                html += '<p><strong>Date Range:</strong> ' + r.dateRange + '</p>';
                html += '<p><strong>Overall:</strong> ' + r.totalServices + ' total, ' + r.tagged + ' tagged, ' + r.alreadyTagged + ' already tagged, ' + r.notFound + ' not found, ' + r.errors + ' errors</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #2196F3; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Services: ' + (club.totalServices || 0) + ' | ';
                        html += 'Tagged: ' + (club.tagged || 0) + ' | ';
                        html += 'Already Tagged: ' + (club.alreadyTagged || 0) + ' | ';
                        html += 'Not Found: ' + (club.notFound || 0) + ' | ';
                        html += 'Errors: ' + (club.errors || 0);
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        // 5. Deactivated PT Services
        if (masterResults.syncs.deactivatedPTServices) {
            const sync = masterResults.syncs.deactivatedPTServices;
            html += '<h2>5️⃣ Deactivated PT Services Sync</h2>';
            html += '<p><strong>Status:</strong> ' + (sync.success ? '✅ Success' : '❌ Failed') + '</p>';
            if (sync.success) {
                const r = sync.results;
                html += '<p><strong>Date Range:</strong> ' + r.dateRange + '</p>';
                html += '<p><strong>Overall:</strong> ' + r.totalServices + ' total, ' + r.tagged + ' tagged, ' + r.alreadyTagged + ' already tagged, ' + r.notFound + ' not found, ' + r.errors + ' errors</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #9C27B0; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Services: ' + (club.totalServices || 0) + ' | ';
                        html += 'Tagged: ' + (club.tagged || 0) + ' | ';
                        html += 'Already Tagged: ' + (club.alreadyTagged || 0) + ' | ';
                        html += 'Not Found: ' + (club.notFound || 0) + ' | ';
                        html += 'Errors: ' + (club.errors || 0);
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        html += '<hr>';
        html += '<p style="color: #666; font-size: 12px;">This is an automated report from the WCS ABC-GHL Integration System</p>';
        
        const msg = {
            to: NOTIFICATION_EMAIL,
            from: EMAIL_USER || 'justin@wcstrength.com',
            subject: '🚀 Daily WCS Sync Report - ' + (success ? 'Success' : 'Failed'),
            html: html
        };
        
        await sgMail.send(msg);
        console.log('📧 Master sync email sent successfully to ' + NOTIFICATION_EMAIL);
        
    } catch (error) {
        console.error('Failed to send master sync email:', error.message);
        if (error.response) {
            console.error('SendGrid error:', error.response.body);
        }
    }
}

/**
 * Make ABC API request with authentication
 */
async function makeABCRequest(endpoint, params = {}) {
    try {
        const url = `${ABC_API_URL}${endpoint}`;
        const response = await axios.get(url, {
            params: {
                ...params,
                app_id: ABC_APP_ID,
                app_key: ABC_APP_KEY
            },
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        console.error('ABC API Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        throw error;
    }
}

/**
 * Make GHL API request
 */
async function makeGHLRequest(method, endpoint, data = null, accessToken) {
    try {
        const url = `${GHL_API_URL}${endpoint}`;
        const config = {
            method: method,
            url: url,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28'
            },
            timeout: 30000
        };
        
        if (data) {
            config.data = data;
        }
        
        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('GHL API Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data));
        }
        throw error;
    }
}

/**
 * Search for contact in GHL by member ID
 */
async function findContactByMemberId(memberId, locationId, accessToken) {
    try {
        const searchResult = await makeGHLRequest(
            'GET',
            `/contacts/?locationId=${locationId}&query=${memberId}`,
            null,
            accessToken
        );
        
        if (searchResult.contacts && searchResult.contacts.length > 0) {
            // Look for exact match on member_id custom field
            const exactMatch = searchResult.contacts.find(contact => {
                return contact.customFields && 
                       contact.customFields.find(field => 
                           field.id === 'member_id' && field.value === memberId.toString()
                       );
            });
            
            if (exactMatch) {
                return exactMatch;
            }
            
            // Fallback to first result if no exact match
            return searchResult.contacts[0];
        }
        
        return null;
    } catch (error) {
        console.error(`Error searching for member ${memberId}:`, error.message);
        return null;
    }
}

/**
 * Format date for GHL (YYYY-MM-DD)
 */
function formatDateForGHL(dateString) {
    if (!dateString) return null;
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;
        return date.toISOString().split('T')[0];
    } catch (error) {
        return null;
    }
}

/**
 * Create or update contact in GHL
 */
async function createOrUpdateContact(member, club, existingContact = null) {
    try {
        // Get the current date in YYYY-MM-DD format for syncing
        const currentDate = new Date().toISOString().split('T')[0];
        
        // Prepare contact data
        const contactData = {
            locationId: club.ghlLocationId,
            firstName: member.firstName || '',
            lastName: member.lastName || '',
            email: member.email || '',
            phone: member.homePhone || member.mobilePhone || '',
            source: 'ABC Financial',
            customFields: []
        };
        
        // Add custom fields - ALWAYS include these fields with current values
        const customFields = {
            'member_id': member.memberId?.toString() || '',
            'club_number': club.clubNumber?.toString() || '',
            'club_name': club.clubName || '',
            'membership_type': member.agreementType || '',
            'membership_status': member.status || '',
            'sign_date': formatDateForGHL(member.signDate) || '',
            'abc_last_sync': currentDate  // ALWAYS update this field
        };
        
        // Convert to GHL format
        for (const [key, value] of Object.entries(customFields)) {
            if (value !== null && value !== undefined) {
                contactData.customFields.push({
                    id: key,
                    field_value: value
                });
            }
        }
        
        if (existingContact) {
            // Update existing contact
            console.log(`   Updating contact ${existingContact.id} for member ${member.memberId}`);
            await makeGHLRequest(
                'PUT',
                `/contacts/${existingContact.id}`,
                contactData,
                club.ghlAccessToken
            );
            return { action: 'updated', contactId: existingContact.id };
        } else {
            // Create new contact
            console.log(`   Creating new contact for member ${member.memberId}`);
            const result = await makeGHLRequest(
                'POST',
                '/contacts/',
                contactData,
                club.ghlAccessToken
            );
            return { action: 'created', contactId: result.contact?.id };
        }
    } catch (error) {
        console.error(`   Error creating/updating contact for member ${member.memberId}:`, error.message);
        throw error;
    }
}

/**
 * Add tag to contact in GHL
 */
async function addTagToContact(contactId, tagName, locationId, accessToken) {
    try {
        await makeGHLRequest(
            'POST',
            `/contacts/${contactId}/tags`,
            { tags: [tagName] },
            accessToken
        );
        console.log(`   ✅ Added tag "${tagName}" to contact ${contactId}`);
        return true;
    } catch (error) {
        console.error(`   ❌ Error adding tag to contact ${contactId}:`, error.message);
        return false;
    }
}

/**
 * Update custom field date on contact
 */
async function updateContactDateField(contactId, fieldId, date, locationId, accessToken) {
    try {
        const currentDate = new Date().toISOString().split('T')[0];
        
        // Update the contact with both the specific date field AND the last sync date
        await makeGHLRequest(
            'PUT',
            `/contacts/${contactId}`,
            {
                locationId: locationId,
                customFields: [
                    {
                        id: fieldId,
                        field_value: date
                    },
                    {
                        id: 'abc_last_sync',
                        field_value: currentDate
                    }
                ]
            },
            accessToken
        );
        console.log(`   ✅ Updated ${fieldId} to ${date} for contact ${contactId}`);
        return true;
    } catch (error) {
        console.error(`   ❌ Error updating date field for contact ${contactId}:`, error.message);
        return false;
    }
}

/**
 * Sync new members endpoint
 */
app.post('/api/sync-new', async (req, res) => {
    console.log('🔄 Starting new members sync...');
    
    const results = {
        totalClubs: 0,
        totalMembers: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        clubs: []
    };
    
    try {
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        // Calculate date range - yesterday only
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startDate = yesterday.toISOString().split('T')[0];
        results.dateRange = startDate;
        
        console.log(`📅 Date Range: ${startDate}`);
        console.log(`🏢 Processing ${enabledClubs.length} clubs...\n`);
        
        for (const club of enabledClubs) {
            console.log(`\n📍 Processing ${club.clubName} (${club.clubNumber})...`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                members: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                errors: 0
            };
            
            try {
                // Fetch members with signDate parameter
                console.log(`   Fetching members with signDate >= ${startDate}...`);
                const membersData = await makeABCRequest('/members', {
                    club_number: club.clubNumber,
                    signDate: startDate,  // Use signDate parameter
                    limit: 1000
                });
                
                const members = membersData.members || [];
                clubResult.members = members.length;
                results.totalMembers += members.length;
                
                console.log(`   Found ${members.length} new members`);
                
                for (const member of members) {
                    try {
                        // Search for existing contact
                        const existingContact = await findContactByMemberId(
                            member.memberId,
                            club.ghlLocationId,
                            club.ghlAccessToken
                        );
                        
                        // Create or update contact
                        const result = await createOrUpdateContact(member, club, existingContact);
                        
                        if (result.action === 'created') {
                            clubResult.created++;
                            results.created++;
                        } else if (result.action === 'updated') {
                            clubResult.updated++;
                            results.updated++;
                        }
                        
                        // Add delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        console.error(`   ❌ Error processing member ${member.memberId}:`, error.message);
                        clubResult.errors++;
                        results.errors++;
                    }
                }
                
                console.log(`   ✅ ${club.clubName} complete: ${clubResult.created} created, ${clubResult.updated} updated, ${clubResult.errors} errors`);
                
            } catch (error) {
                console.error(`   ❌ Error processing club ${club.clubName}:`, error.message);
                clubResult.errors++;
                results.errors++;
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log('\n✅ New members sync complete!');
        console.log(`📊 Total: ${results.totalMembers} members, ${results.created} created, ${results.updated} updated, ${results.errors} errors`);
        
        res.json({
            success: true,
            message: 'New members sync completed successfully',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ New members sync failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results: results
        });
    }
});

/**
 * Sync cancelled members endpoint
 */
app.post('/api/sync-cancelled', async (req, res) => {
    console.log('🔄 Starting cancelled members sync...');
    
    const results = {
        totalClubs: 0,
        totalMembers: 0,
        tagged: 0,
        alreadyTagged: 0,
        notFound: 0,
        errors: 0,
        clubs: []
    };
    
    try {
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        // Calculate date range - yesterday only
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startDate = yesterday.toISOString().split('T')[0];
        results.dateRange = startDate;
        
        console.log(`📅 Date Range: ${startDate}`);
        console.log(`🏢 Processing ${enabledClubs.length} clubs...\n`);
        
        for (const club of enabledClubs) {
            console.log(`\n📍 Processing ${club.clubName} (${club.clubNumber})...`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalMembers: 0,
                tagged: 0,
                alreadyTagged: 0,
                notFound: 0,
                errors: 0
            };
            
            try {
                // Fetch cancelled members with cancelDate parameter
                console.log(`   Fetching cancelled members with cancelDate >= ${startDate}...`);
                const membersData = await makeABCRequest('/members', {
                    club_number: club.clubNumber,
                    cancelDate: startDate,  // Use cancelDate parameter
                    status: 'C',
                    limit: 1000
                });
                
                const members = membersData.members || [];
                clubResult.totalMembers = members.length;
                results.totalMembers += members.length;
                
                console.log(`   Found ${members.length} cancelled members`);
                
                for (const member of members) {
                    try {
                        // Search for existing contact
                        const existingContact = await findContactByMemberId(
                            member.memberId,
                            club.ghlLocationId,
                            club.ghlAccessToken
                        );
                        
                        if (!existingContact) {
                            console.log(`   ⚠️ Member ${member.memberId} not found in GHL`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        // Check if already has the tag
                        const hasTag = existingContact.tags && existingContact.tags.includes('Cancelled');
                        
                        if (hasTag) {
                            console.log(`   ℹ️ Member ${member.memberId} already has Cancelled tag`);
                            clubResult.alreadyTagged++;
                            results.alreadyTagged++;
                            
                            // Update the cancel date anyway
                            const cancelDate = formatDateForGHL(member.cancelDate);
                            if (cancelDate) {
                                await updateContactDateField(
                                    existingContact.id,
                                    'cancel_date',
                                    cancelDate,
                                    club.ghlLocationId,
                                    club.ghlAccessToken
                                );
                            }
                        } else {
                            // Add Cancelled tag
                            const tagAdded = await addTagToContact(
                                existingContact.id,
                                'Cancelled',
                                club.ghlLocationId,
                                club.ghlAccessToken
                            );
                            
                            if (tagAdded) {
                                clubResult.tagged++;
                                results.tagged++;
                                
                                // Update the cancel date
                                const cancelDate = formatDateForGHL(member.cancelDate);
                                if (cancelDate) {
                                    await updateContactDateField(
                                        existingContact.id,
                                        'cancel_date',
                                        cancelDate,
                                        club.ghlLocationId,
                                        club.ghlAccessToken
                                    );
                                }
                            } else {
                                clubResult.errors++;
                                results.errors++;
                            }
                        }
                        
                        // Add delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        console.error(`   ❌ Error processing member ${member.memberId}:`, error.message);
                        clubResult.errors++;
                        results.errors++;
                    }
                }
                
                console.log(`   ✅ ${club.clubName} complete: ${clubResult.tagged} tagged, ${clubResult.alreadyTagged} already tagged, ${clubResult.notFound} not found, ${clubResult.errors} errors`);
                
            } catch (error) {
                console.error(`   ❌ Error processing club ${club.clubName}:`, error.message);
                clubResult.errors++;
                results.errors++;
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log('\n✅ Cancelled members sync complete!');
        console.log(`📊 Total: ${results.totalMembers} members, ${results.tagged} tagged, ${results.alreadyTagged} already tagged, ${results.errors} errors`);
        
        res.json({
            success: true,
            message: 'Cancelled members sync completed successfully',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Cancelled members sync failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results: results
        });
    }
});

/**
 * Sync past due members endpoint
 */
app.post('/api/sync-past-due', async (req, res) => {
    console.log('🔄 Starting past due members sync (3 days)...');
    
    const results = {
        totalClubs: 0,
        totalMembers: 0,
        tagged: 0,
        notFound: 0,
        errors: 0,
        clubs: []
    };
    
    try {
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        console.log(`🏢 Processing ${enabledClubs.length} clubs...\n`);
        
        for (const club of enabledClubs) {
            console.log(`\n📍 Processing ${club.clubName} (${club.clubNumber})...`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                members: 0,
                tagged: 0,
                notFound: 0,
                errors: 0
            };
            
            try {
                // Fetch past due members (3 days past due)
                console.log(`   Fetching members with 3 days past due...`);
                const membersData = await makeABCRequest('/members', {
                    club_number: club.clubNumber,
                    past_due_days: 3,
                    limit: 1000
                });
                
                const members = membersData.members || [];
                clubResult.members = members.length;
                results.totalMembers += members.length;
                
                console.log(`   Found ${members.length} members 3 days past due`);
                
                for (const member of members) {
                    try {
                        // Search for existing contact
                        const existingContact = await findContactByMemberId(
                            member.memberId,
                            club.ghlLocationId,
                            club.ghlAccessToken
                        );
                        
                        if (!existingContact) {
                            console.log(`   ⚠️ Member ${member.memberId} not found in GHL`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        // Add Past Due tag
                        const tagAdded = await addTagToContact(
                            existingContact.id,
                            'Past Due',
                            club.ghlLocationId,
                            club.ghlAccessToken
                        );
                        
                        if (tagAdded) {
                            clubResult.tagged++;
                            results.tagged++;
                            
                            // Update the past_due_date field with current date
                            const currentDate = new Date().toISOString().split('T')[0];
                            await updateContactDateField(
                                existingContact.id,
                                'past_due_date',
                                currentDate,
                                club.ghlLocationId,
                                club.ghlAccessToken
                            );
                        } else {
                            clubResult.errors++;
                            results.errors++;
                        }
                        
                        // Add delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        console.error(`   ❌ Error processing member ${member.memberId}:`, error.message);
                        clubResult.errors++;
                        results.errors++;
                    }
                }
                
                console.log(`   ✅ ${club.clubName} complete: ${clubResult.tagged} tagged, ${clubResult.notFound} not found, ${clubResult.errors} errors`);
                
            } catch (error) {
                console.error(`   ❌ Error processing club ${club.clubName}:`, error.message);
                clubResult.errors++;
                results.errors++;
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log('\n✅ Past due members sync complete!');
        console.log(`📊 Total: ${results.totalMembers} members, ${results.tagged} tagged, ${results.errors} errors`);
        
        res.json({
            success: true,
            message: 'Past due members sync completed successfully',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Past due members sync failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results: results
        });
    }
});

/**
 * Sync new PT services endpoint
 */
app.post('/api/sync-pt-new', async (req, res) => {
    console.log('🔄 Starting new PT services sync...');
    
    const results = {
        totalClubs: 0,
        totalServices: 0,
        tagged: 0,
        alreadyTagged: 0,
        notFound: 0,
        errors: 0,
        clubs: []
    };
    
    try {
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        // Calculate date range - yesterday only
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startDate = yesterday.toISOString().split('T')[0];
        results.dateRange = startDate;
        
        console.log(`📅 Date Range: ${startDate}`);
        console.log(`🏢 Processing ${enabledClubs.length} clubs...\n`);
        
        for (const club of enabledClubs) {
            console.log(`\n📍 Processing ${club.clubName} (${club.clubNumber})...`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalServices: 0,
                tagged: 0,
                alreadyTagged: 0,
                notFound: 0,
                errors: 0
            };
            
            try {
                // Fetch new PT services with startDate parameter
                console.log(`   Fetching PT services with startDate >= ${startDate}...`);
                const servicesData = await makeABCRequest('/services', {
                    club_number: club.clubNumber,
                    service_name: 'Personal Training',
                    startDate: startDate,  // Use startDate parameter for services
                    status: 'active',
                    limit: 1000
                });
                
                const services = servicesData.services || [];
                clubResult.totalServices = services.length;
                results.totalServices += services.length;
                
                console.log(`   Found ${services.length} new PT services`);
                
                for (const service of services) {
                    try {
                        // Search for existing contact
                        const existingContact = await findContactByMemberId(
                            service.memberId,
                            club.ghlLocationId,
                            club.ghlAccessToken
                        );
                        
                        if (!existingContact) {
                            console.log(`   ⚠️ Member ${service.memberId} not found in GHL`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        // Check if already has the tag
                        const hasTag = existingContact.tags && existingContact.tags.includes('PT Member');
                        
                        if (hasTag) {
                            console.log(`   ℹ️ Member ${service.memberId} already has PT Member tag`);
                            clubResult.alreadyTagged++;
                            results.alreadyTagged++;
                            
                            // Update the PT start date anyway
                            const ptStartDate = formatDateForGHL(service.startDate);
                            if (ptStartDate) {
                                await updateContactDateField(
                                    existingContact.id,
                                    'pt_start_date',
                                    ptStartDate,
                                    club.ghlLocationId,
                                    club.ghlAccessToken
                                );
                            }
                        } else {
                            // Add PT Member tag
                            const tagAdded = await addTagToContact(
                                existingContact.id,
                                'PT Member',
                                club.ghlLocationId,
                                club.ghlAccessToken
                            );
                            
                            if (tagAdded) {
                                clubResult.tagged++;
                                results.tagged++;
                                
                                // Update the PT start date
                                const ptStartDate = formatDateForGHL(service.startDate);
                                if (ptStartDate) {
                                    await updateContactDateField(
                                        existingContact.id,
                                        'pt_start_date',
                                        ptStartDate,
                                        club.ghlLocationId,
                                        club.ghlAccessToken
                                    );
                                }
                            } else {
                                clubResult.errors++;
                                results.errors++;
                            }
                        }
                        
                        // Add delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        console.error(`   ❌ Error processing service for member ${service.memberId}:`, error.message);
                        clubResult.errors++;
                        results.errors++;
                    }
                }
                
                console.log(`   ✅ ${club.clubName} complete: ${clubResult.tagged} tagged, ${clubResult.alreadyTagged} already tagged, ${clubResult.notFound} not found, ${clubResult.errors} errors`);
                
            } catch (error) {
                console.error(`   ❌ Error processing club ${club.clubName}:`, error.message);
                clubResult.errors++;
                results.errors++;
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log('\n✅ New PT services sync complete!');
        console.log(`📊 Total: ${results.totalServices} services, ${results.tagged} tagged, ${results.alreadyTagged} already tagged, ${results.errors} errors`);
        
        res.json({
            success: true,
            message: 'New PT services sync completed successfully',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ New PT services sync failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results: results
        });
    }
});

/**
 * Sync deactivated PT services endpoint
 */
app.post('/api/sync-pt-deactivated', async (req, res) => {
    console.log('🔄 Starting deactivated PT services sync...');
    
    const results = {
        totalClubs: 0,
        totalServices: 0,
        tagged: 0,
        alreadyTagged: 0,
        notFound: 0,
        errors: 0,
        clubs: []
    };
    
    try {
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        // Calculate date range - yesterday only
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startDate = yesterday.toISOString().split('T')[0];
        results.dateRange = startDate;
        
        console.log(`📅 Date Range: ${startDate}`);
        console.log(`🏢 Processing ${enabledClubs.length} clubs...\n`);
        
        for (const club of enabledClubs) {
            console.log(`\n📍 Processing ${club.clubName} (${club.clubNumber})...`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalServices: 0,
                tagged: 0,
                alreadyTagged: 0,
                notFound: 0,
                errors: 0
            };
            
            try {
                // Fetch deactivated PT services with endDate parameter
                console.log(`   Fetching deactivated PT services with endDate >= ${startDate}...`);
                const servicesData = await makeABCRequest('/services', {
                    club_number: club.clubNumber,
                    service_name: 'Personal Training',
                    endDate: startDate,  // Use endDate parameter for deactivated services
                    status: 'inactive',
                    limit: 1000
                });
                
                const services = servicesData.services || [];
                clubResult.totalServices = services.length;
                results.totalServices += services.length;
                
                console.log(`   Found ${services.length} deactivated PT services`);
                
                for (const service of services) {
                    try {
                        // Search for existing contact
                        const existingContact = await findContactByMemberId(
                            service.memberId,
                            club.ghlLocationId,
                            club.ghlAccessToken
                        );
                        
                        if (!existingContact) {
                            console.log(`   ⚠️ Member ${service.memberId} not found in GHL`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        // Check if already has the tag
                        const hasTag = existingContact.tags && existingContact.tags.includes('PT Deactivated');
                        
                        if (hasTag) {
                            console.log(`   ℹ️ Member ${service.memberId} already has PT Deactivated tag`);
                            clubResult.alreadyTagged++;
                            results.alreadyTagged++;
                            
                            // Update the PT end date anyway
                            const ptEndDate = formatDateForGHL(service.endDate);
                            if (ptEndDate) {
                                await updateContactDateField(
                                    existingContact.id,
                                    'pt_end_date',
                                    ptEndDate,
                                    club.ghlLocationId,
                                    club.ghlAccessToken
                                );
                            }
                        } else {
                            // Add PT Deactivated tag
                            const tagAdded = await addTagToContact(
                                existingContact.id,
                                'PT Deactivated',
                                club.ghlLocationId,
                                club.ghlAccessToken
                            );
                            
                            if (tagAdded) {
                                clubResult.tagged++;
                                results.tagged++;
                                
                                // Update the PT end date
                                const ptEndDate = formatDateForGHL(service.endDate);
                                if (ptEndDate) {
                                    await updateContactDateField(
                                        existingContact.id,
                                        'pt_end_date',
                                        ptEndDate,
                                        club.ghlLocationId,
                                        club.ghlAccessToken
                                    );
                                }
                            } else {
                                clubResult.errors++;
                                results.errors++;
                            }
                        }
                        
                        // Add delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        console.error(`   ❌ Error processing service for member ${service.memberId}:`, error.message);
                        clubResult.errors++;
                        results.errors++;
                    }
                }
                
                console.log(`   ✅ ${club.clubName} complete: ${clubResult.tagged} tagged, ${clubResult.alreadyTagged} already tagged, ${clubResult.notFound} not found, ${clubResult.errors} errors`);
                
            } catch (error) {
                console.error(`   ❌ Error processing club ${club.clubName}:`, error.message);
                clubResult.errors++;
                results.errors++;
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log('\n✅ Deactivated PT services sync complete!');
        console.log(`📊 Total: ${results.totalServices} services, ${results.tagged} tagged, ${results.alreadyTagged} already tagged, ${results.errors} errors`);
        
        res.json({
            success: true,
            message: 'Deactivated PT services sync completed successfully',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Deactivated PT services sync failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results: results
        });
    }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        clubs: clubsConfig.clubs.length
    });
});

/**
 * Master sync endpoint - runs all 5 syncs in sequence
 */
app.post('/api/master-sync', async (req, res) => {
    console.log('\n🚀 MASTER SYNC INITIATED\n');
    console.log('═══════════════════════════════════════════════════════════');
    
    const masterResults = {
        startTime: new Date().toISOString(),
        endTime: null,
        totalDuration: null,
        syncs: {}
    };
    
    try {
        // 1. Sync new members
        console.log('\n📝 [1/5] Running new members sync...');
        try {
            const newMembersResponse = await axios.post(`http://localhost:${PORT}/api/sync-new`, {});
            masterResults.syncs.newMembers = {
                success: true,
                results: newMembersResponse.data.results
            };
            console.log('✅ New members sync complete');
        } catch (error) {
            masterResults.syncs.newMembers = {
                success: false,
                error: error.message
            };
            console.error('❌ New members sync failed:', error.message);
        }
        
        // 2. Sync cancelled members
        console.log('\n📝 [2/5] Running cancelled members sync...');
        try {
            const cancelledResponse = await axios.post(`http://localhost:${PORT}/api/sync-cancelled`, {});
            masterResults.syncs.cancelledMembers = {
                success: true,
                results: cancelledResponse.data.results
            };
            console.log('✅ Cancelled members sync complete');
        } catch (error) {
            masterResults.syncs.cancelledMembers = {
                success: false,
                error: error.message
            };
            console.error('❌ Cancelled members sync failed:', error.message);
        }
        
        // 3. Sync past due members
        console.log('\n📝 [3/5] Running past due members sync...');
        try {
            const pastDueResponse = await axios.post(`http://localhost:${PORT}/api/sync-past-due`, {});
            masterResults.syncs.pastDueMembers = {
                success: true,
                results: pastDueResponse.data.results
            };
            console.log('✅ Past due members sync complete');
        } catch (error) {
            masterResults.syncs.pastDueMembers = {
                success: false,
                error: error.message
            };
            console.error('❌ Past due members sync failed:', error.message);
        }
        
        // 4. Sync new PT services
        console.log('\n📝 [4/5] Running new PT services sync...');
        try {
            const ptNewResponse = await axios.post(`http://localhost:${PORT}/api/sync-pt-new`, {});
            masterResults.syncs.newPTServices = {
                success: true,
                results: ptNewResponse.data.results
            };
            console.log('✅ New PT services sync complete');
        } catch (error) {
            masterResults.syncs.newPTServices = {
                success: false,
                error: error.message
            };
            console.error('❌ New PT services sync failed:', error.message);
        }
        
        // 5. Sync deactivated PT services
        console.log('\n📝 [5/5] Running deactivated PT services sync...');
        try {
            const ptDeactivatedResponse = await axios.post(`http://localhost:${PORT}/api/sync-pt-deactivated`, {});
            masterResults.syncs.deactivatedPTServices = {
                success: true,
                results: ptDeactivatedResponse.data.results
            };
            console.log('✅ Deactivated PT services sync complete');
        } catch (error) {
            masterResults.syncs.deactivatedPTServices = {
                success: false,
                error: error.message
            };
            console.error('❌ Deactivated PT services sync failed:', error.message);
        }
        
        // Calculate duration
        masterResults.endTime = new Date().toISOString();
        const duration = new Date(masterResults.endTime) - new Date(masterResults.startTime);
        masterResults.totalDuration = `${Math.floor(duration / 1000 / 60)} minutes ${Math.floor((duration / 1000) % 60)} seconds`;
        
        console.log('\n✅ Master Sync Complete!');
        console.log(`Total Duration: ${masterResults.totalDuration}`);
        
        // Send comprehensive email
        await sendMasterSyncEmail(masterResults);
        
        res.json({
            success: true,
            message: 'Master sync completed - all endpoints processed',
            results: masterResults,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Master sync error:', error);
        
        masterResults.endTime = new Date().toISOString();
        masterResults.error = error.message;
        
        // Send error email
        await sendMasterSyncEmail(masterResults, false);
        
        res.status(500).json({
            success: false,
            error: error.message,
            results: masterResults
        });
    }
});

// Test email endpoint - just sends a test email
app.get('/api/test-email', async (req, res) => {
    console.log('Testing email notification...');
    
    // Create fake results for testing
    const testResults = {
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        totalDuration: '2 minutes 30 seconds',
        syncs: {
            newMembers: {
                success: true,
                results: {
                    totalClubs: 2,
                    totalMembers: 50,
                    created: 25,
                    updated: 25,
                    skipped: 0,
                    errors: 0,
                    dateRange: '2025-11-10'
                }
            },
            cancelledMembers: {
                success: true,
                results: {
                    totalClubs: 2,
                    totalMembers: 5,
                    tagged: 5,
                    alreadyTagged: 0,
                    notFound: 0,
                    errors: 0
                }
            }
        }
    };
    
    try {
        await sendMasterSyncEmail(testResults);
        res.json({
            success: true,
            message: 'Test email sent! Check justin@wcstrength.com'
        });
    } catch (error) {
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
    console.log(`   Clubs Loaded: ${clubsConfig.clubs.length} clubs`);
    
    // Show club summary
    const enabledClubs = clubsConfig.clubs.filter(c => c.enabled !== false);
    console.log(`   Enabled Clubs: ${enabledClubs.length}`);
    enabledClubs.forEach(club => {
        console.log(`      - ${club.clubName} (${club.clubNumber})`);
    });
    
    console.log(`\n📝 Ready to sync members!\n`);
});
