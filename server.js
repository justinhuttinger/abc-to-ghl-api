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
        // Generate CSV data
        let csvData = 'Sync Type,Club Name,Club Number,Member Name,Email,Phone,Action,Date,Notes\n';
        
        // 1. New Members
        if (masterResults.syncs.newMembers && masterResults.syncs.newMembers.success) {
            const sync = masterResults.syncs.newMembers.results;
            if (sync.clubs) {
                sync.clubs.forEach(club => {
                    if (club.syncedMembers && club.syncedMembers.length > 0) {
                        club.syncedMembers.forEach(member => {
                            csvData += `New Members,${club.clubName},${club.clubNumber},"${member.name}",${member.email},${member.phone},${member.action},${member.signDate},"Membership: ${member.membershipType}"\n`;
                        });
                    }
                });
            }
        }
        
        // 2. Cancelled Members
        if (masterResults.syncs.cancelledMembers && masterResults.syncs.cancelledMembers.success) {
            const sync = masterResults.syncs.cancelledMembers.results;
            if (sync.clubs) {
                sync.clubs.forEach(club => {
                    if (club.members && club.members.length > 0) {
                        club.members.forEach(member => {
                            csvData += `Cancelled Members,${club.clubName},${club.clubNumber},"${member.name}",${member.email},,${member.action},${member.cancelDate || ''},"Cancel reason: ${member.cancelReason || 'N/A'}"\n`;
                        });
                    }
                });
            }
        }
        
        // 3. Past Due Members  
        if (masterResults.syncs.pastDueMembers && masterResults.syncs.pastDueMembers.success) {
            const sync = masterResults.syncs.pastDueMembers.results;
            if (sync.clubs) {
                sync.clubs.forEach(club => {
                    if (club.members && club.members.length > 0) {
                        club.members.forEach(member => {
                            csvData += `Past Due Members,${club.clubName},${club.clubNumber},"${member.name}",${member.email},,${member.action},,${member.daysOverdue} days overdue\n`;
                        });
                    }
                });
            }
        }
        
        // 4. New PT Services
        if (masterResults.syncs.newPTServices && masterResults.syncs.newPTServices.success) {
            const sync = masterResults.syncs.newPTServices.results;
            if (sync.clubs) {
                sync.clubs.forEach(club => {
                    if (club.services && club.services.length > 0) {
                        club.services.forEach(service => {
                            csvData += `New PT Services,${club.clubName},${club.clubNumber},"${service.memberName}",${service.email},,${service.action},${service.saleDate || ''},"Service: ${service.serviceItem || 'N/A'}"\n`;
                        });
                    }
                });
            }
        }
        
        // 5. Deactivated PT Services
        if (masterResults.syncs.deactivatedPTServices && masterResults.syncs.deactivatedPTServices.success) {
            const sync = masterResults.syncs.deactivatedPTServices.results;
            if (sync.clubs) {
                sync.clubs.forEach(club => {
                    if (club.services && club.services.length > 0) {
                        club.services.forEach(service => {
                            csvData += `Deactivated PT Services,${club.clubName},${club.clubNumber},"${service.memberName}",${service.email},,${service.action},${service.inactiveDate || ''},"Service: ${service.serviceItem || 'N/A'} | Reason: ${service.deactivateReason || 'N/A'}"\n`;
                        });
                    }
                });
            }
        }
        
        // 6. PIF Completed
        if (masterResults.syncs.pifCompleted && masterResults.syncs.pifCompleted.success) {
            const sync = masterResults.syncs.pifCompleted.results;
            if (sync.clubs) {
                sync.clubs.forEach(club => {
                    if (club.members && club.members.length > 0) {
                        club.members.forEach(member => {
                            csvData += `PIF Completed,${club.clubName},${club.clubNumber},"${member.name}",${member.email},,${member.action},,Sessions: ${member.availableSessions}\n`;
                        });
                    }
                });
            }
        }
        
        // Create CSV attachment
        const csvBuffer = Buffer.from(csvData, 'utf-8');
        const today = new Date().toISOString().split('T')[0];
        
        let html = '<h1>🚀 Daily WCS Sync Report</h1>';
        html += '<p><strong>Status:</strong> ' + (success ? '✅ ALL SYNCS COMPLETE' : '❌ SOME SYNCS FAILED') + '</p>';
        html += '<p><strong>Start Time:</strong> ' + masterResults.startTime + '</p>';
        html += '<p><strong>End Time:</strong> ' + masterResults.endTime + '</p>';
        html += '<p><strong>Total Duration:</strong> ' + masterResults.totalDuration + '</p>';
        html += '<p>📎 <strong>Detailed report attached as CSV</strong></p>';
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
                        html += 'Members: ' + club.members + ' | ';
                        html += 'Created: ' + club.created + ' | ';
                        html += 'Updated: ' + club.updated + ' | ';
                        html += 'Skipped: ' + club.skipped + ' | ';
                        html += 'Errors: ' + (Array.isArray(club.errors) ? club.errors.length : club.errors);
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
                        html += 'Members: ' + club.totalMembers + ' | ';
                        html += 'Tagged: ' + club.tagged + ' | ';
                        html += 'Already Tagged: ' + club.alreadyTagged + ' | ';
                        html += 'Not Found: ' + club.notFound + ' | ';
                        html += 'Errors: ' + club.errors;
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
                        html += 'Members: ' + club.totalMembers + ' | ';
                        html += 'Tagged: ' + club.tagged + ' | ';
                        html += 'Already Tagged: ' + club.alreadyTagged + ' | ';
                        html += 'Not Found: ' + club.notFound + ' | ';
                        html += 'Errors: ' + club.errors;
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
                html += '<p><strong>Overall:</strong> ' + r.totalServices + ' services, ' + r.created + ' created, ' + r.updated + ' updated, ' + r.tagged + ' tagged</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #2196F3; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Services: ' + club.totalServices + ' | ';
                        html += 'Created: ' + club.created + ' | ';
                        html += 'Updated: ' + club.updated + ' | ';
                        html += 'Tagged: ' + club.tagged + ' | ';
                        html += 'Errors: ' + club.errors;
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
                html += '<p><strong>Overall:</strong> ' + r.totalServices + ' services deactivated, ' + r.tagged + ' tagged</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #9C27B0; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Services: ' + club.totalServices + ' | ';
                        html += 'Created: ' + club.created + ' | ';
                        html += 'Updated: ' + club.updated + ' | ';
                        html += 'Tagged: ' + club.tagged + ' | ';
                        html += 'Errors: ' + club.errors;
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        // 6. PIF Completed
        if (masterResults.syncs.pifCompleted) {
            const sync = masterResults.syncs.pifCompleted;
            html += '<h2>6️⃣ PIF Completion Check</h2>';
            html += '<p><strong>Status:</strong> ' + (sync.success ? '✅ Success' : '❌ Failed') + '</p>';
            if (sync.success) {
                const r = sync.results;
                html += '<p><strong>Overall:</strong> ' + r.totalChecked + ' checked, ' + r.completed + ' completed, ' + r.stillActive + ' still active, ' + r.notFound + ' not found, ' + r.errors + ' errors</p>';
                
                // Club-by-club breakdown
                html += '<h3>By Club:</h3>';
                if (r.clubs && r.clubs.length > 0) {
                    r.clubs.forEach(club => {
                        html += '<div style="margin-left: 20px; margin-bottom: 15px; border-left: 3px solid #673AB7; padding-left: 10px;">';
                        html += '<strong>' + club.clubName + ' (#' + club.clubNumber + ')</strong><br>';
                        html += 'Checked: ' + club.checked + ' | ';
                        html += 'Completed: ' + club.completed + ' | ';
                        html += 'Still Active: ' + club.stillActive + ' | ';
                        html += 'Not Found: ' + club.notFound + ' | ';
                        html += 'Errors: ' + club.errors;
                        html += '</div>';
                    });
                }
            } else {
                html += '<p style="color: red;">Error: ' + sync.error + '</p>';
            }
        }
        
        html += '<hr>';
        html += '<p style="color: #666; font-size: 12px;">Automated report from WCS Sync Server</p>';
        
        const msg = {
            to: NOTIFICATION_EMAIL,
            from: EMAIL_USER || 'justin@wcstrength.com',
            subject: success ? '✅ Daily Sync Complete - ' + masterResults.totalDuration : '❌ Daily Sync Failed',
            html: html,
            attachments: [
                {
                    content: csvBuffer.toString('base64'),
                    filename: `wcs_sync_report_${today}.csv`,
                    type: 'text/csv',
                    disposition: 'attachment'
                }
            ]
        };
        
        await sgMail.send(msg);
        console.log('📧 Master sync email sent to ' + NOTIFICATION_EMAIL + ' with CSV attachment');
        
    } catch (error) {
        console.error('Failed to send master sync email:', error.message);
        if (error.response) {
            console.error('SendGrid error:', error.response.body);
        }
    }
}


// ====================================
// UTILITY FUNCTIONS
// ====================================

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
        
        // Fetch all members using pagination
        let allMembers = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        console.log(`Fetching all members from ABC club ${clubNumber} with pagination...`);
        
        while (hasMorePages) {
            const params = {
                size: 5000,
                page: currentPage
            };
            
            console.log(`  Fetching page ${currentPage}...`);
            
            const response = await axios.get(url, {
                headers: {
                    'accept': 'application/json',
                    'app_id': ABC_APP_ID,
                    'app_key': ABC_APP_KEY
                },
                params: params
            });
            
            const members = response.data.members || [];
            allMembers = allMembers.concat(members);
            
            console.log(`  Page ${currentPage}: ${members.length} members`);
            
            // Check if there's a next page
            const nextPage = response.data.status?.nextPage;
            if (nextPage && members.length > 0) {
                currentPage++;
            } else {
                hasMorePages = false;
            }
            
            // Safety limit: stop after 50 pages (250,000 members max)
            // This prevents infinite loops while supporting very large gym chains
            if (currentPage > 50) {
                console.log(`  ⚠️ Reached safety limit of 50 pages (250k members)`);
                hasMorePages = false;
            }
        }
        
        console.log(`Total members fetched: ${allMembers.length}`);
        
        // Filter out prospects - only keep actual members
        allMembers = allMembers.filter(member => {
            return member.personal?.joinStatus === 'Member';
        });
        console.log(`Filtered to ${allMembers.length} actual members (excluding prospects)`);
        
        // Filter by signDate if date range provided
        if (startDate && endDate) {
            console.log(`Filtering by signDate between ${startDate} and ${endDate}`);
            
            allMembers = allMembers.filter(member => {
                const signDate = member.agreement?.signDate;
                if (!signDate) return false;
                
                // Extract just the date part (YYYY-MM-DD)
                const memberDate = signDate.split('T')[0];
                
                // Check if date falls in range
                return memberDate >= startDate && memberDate <= endDate;
            });
            
            console.log(`Filtered to ${allMembers.length} members with signDate in range`);
        }
        
        return allMembers;
        
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
        
        // Fetch all members using pagination
        let allMembers = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        console.log(`Fetching all members from ABC club ${clubNumber} with pagination...`);
        
        while (hasMorePages) {
            const params = {
                size: 5000,
                page: currentPage
            };
            
            console.log(`  Fetching page ${currentPage}...`);
            
            const response = await axios.get(url, {
                headers: {
                    'accept': 'application/json',
                    'app_id': ABC_APP_ID,
                    'app_key': ABC_APP_KEY
                },
                params: params
            });
            
            const members = response.data.members || [];
            allMembers = allMembers.concat(members);
            
            console.log(`  Page ${currentPage}: ${members.length} members`);
            
            // Check if there's a next page
            const nextPage = response.data.status?.nextPage;
            if (nextPage && members.length > 0) {
                currentPage++;
            } else {
                hasMorePages = false;
            }
            
            // Safety limit: stop after 50 pages (250,000 members max)
            // This prevents infinite loops while supporting very large gym chains
            if (currentPage > 50) {
                console.log(`  ⚠️ Reached safety limit of 50 pages (250k members)`);
                hasMorePages = false;
            }
        }
        
        console.log(`Total members fetched: ${allMembers.length}`);
        
        // Filter out prospects - only keep actual members
        allMembers = allMembers.filter(member => {
            return member.personal?.joinStatus === 'Member';
        });
        console.log(`Filtered to ${allMembers.length} actual members (excluding prospects)`);
        
        // Filter for inactive members (isActive can be boolean false or string "false")
        allMembers = allMembers.filter(member => {
            const isActive = member.personal?.isActive;
            // Check for boolean false or string "false"
            return isActive === false || isActive === 'false';
        });
        
        console.log(`Filtered to ${allMembers.length} inactive members`);
        
        // Filter by memberStatusDate if date range provided
        if (startDate && endDate) {
            console.log(`Filtering by memberStatusDate between ${startDate} and ${endDate}`);
            
            allMembers = allMembers.filter(member => {
                const statusDate = member.personal?.memberStatusDate;
                if (!statusDate) return false;
                
                // Extract just the date part (YYYY-MM-DD)
                // memberStatusDate format: "1997-08-13" or "1997-08-13T00:00:00"
                const memberDate = statusDate.split('T')[0];
                
                // Check if date falls in range
                return memberDate >= startDate && memberDate <= endDate;
            });
            
            console.log(`Filtered to ${allMembers.length} with memberStatusDate in range`);
        }
        
        // Log breakdown of statuses
        const statusCounts = {};
        allMembers.forEach(m => {
            const status = m.personal?.memberStatus || 'Unknown';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        console.log(`Final count by status:`);
        Object.entries(statusCounts).forEach(([status, count]) => {
            console.log(`  - ${status}: ${count}`);
        });
        
        return allMembers;
        
    } catch (error) {
        console.error('Error fetching cancelled members from ABC:', error.message);
        if (error.response) {
            console.error('ABC API Response:', error.response.data);
        }
        throw new Error(`ABC API Error: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Fetch active members who are exactly 3 days past due
 * @param {string} clubNumber - The club number
 * @returns {Promise<Array>} Array of past due members
 */
async function fetchOneDayPastDueMembers(clubNumber) {
    try {
        const url = `${ABC_API_URL}/${clubNumber}/members`;
        
        // Fetch all members using pagination
        let allMembers = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        console.log(`Fetching all members from ABC club ${clubNumber} with pagination...`);
        
        while (hasMorePages) {
            const params = {
                size: 5000,
                page: currentPage
            };
            
            console.log(`  Fetching page ${currentPage}...`);
            
            const response = await axios.get(url, {
                headers: {
                    'accept': 'application/json',
                    'app_id': ABC_APP_ID,
                    'app_key': ABC_APP_KEY
                },
                params: params
            });
            
            const members = response.data.members || [];
            allMembers = allMembers.concat(members);
            
            console.log(`  Page ${currentPage}: ${members.length} members`);
            
            // Check if there's a next page
            const nextPage = response.data.status?.nextPage;
            if (nextPage && members.length > 0) {
                currentPage++;
            } else {
                hasMorePages = false;
            }
            
            // Safety limit: stop after 50 pages (250,000 members max)
            if (currentPage > 50) {
                console.log(`  ⚠️ Reached safety limit of 50 pages (250k members)`);
                hasMorePages = false;
            }
        }
        
        console.log(`Total members fetched: ${allMembers.length}`);
        
        // Filter out prospects - only keep actual members
        allMembers = allMembers.filter(member => {
            return member.personal?.joinStatus === 'Member';
        });
        console.log(`Filtered to ${allMembers.length} actual members (excluding prospects)`);
        
        // Filter for ACTIVE members only
        allMembers = allMembers.filter(member => {
            const isActive = member.personal?.isActive;
            return isActive === true || isActive === 'true';
        });
        console.log(`Filtered to ${allMembers.length} ACTIVE members`);
        
        // Calculate today at midnight for consistent comparison
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        console.log(`\n=== PAST DUE ANALYSIS ===`);
        console.log(`Today's date: ${today.toISOString().split('T')[0]}`);
        console.log(`Looking for nextBillingDate: ${new Date(today - 3*24*60*60*1000).toISOString().split('T')[0]} (3 days ago)`);
        
        // First, let's see ALL members with past billing dates (for debugging)
        const membersWithPastBillingDates = allMembers.filter(member => {
            const nextBillingDate = member.agreement?.nextBillingDate;
            if (!nextBillingDate) return false;
            
            const billingDate = new Date(nextBillingDate.split('T')[0]);
            billingDate.setHours(0, 0, 0, 0);
            
            return billingDate < today;
        });
        
        console.log(`\nTotal ACTIVE members with billing dates in the past: ${membersWithPastBillingDates.length}`);
        
        // Show breakdown of how many days past due
        if (membersWithPastBillingDates.length > 0) {
            const breakdown = {};
            membersWithPastBillingDates.forEach(member => {
                const billingDate = new Date(member.agreement.nextBillingDate.split('T')[0]);
                billingDate.setHours(0, 0, 0, 0);
                const daysDiff = Math.floor((today - billingDate) / (1000 * 60 * 60 * 24));
                breakdown[daysDiff] = (breakdown[daysDiff] || 0) + 1;
            });
            
            console.log(`\nBreakdown by days past due:`);
            Object.keys(breakdown).sort((a, b) => a - b).forEach(days => {
                console.log(`  ${days} day(s) past due: ${breakdown[days]} members`);
            });
        }
        
        // Now filter for exactly 3 days past due
        const threeDaysPastDue = allMembers.filter(member => {
            const nextBillingDate = member.agreement?.nextBillingDate;
            if (!nextBillingDate) return false;
            
            const billingDate = new Date(nextBillingDate.split('T')[0]);
            billingDate.setHours(0, 0, 0, 0);
            
            // Calculate days past due
            const daysDiff = Math.floor((today - billingDate) / (1000 * 60 * 60 * 24));
            
            return daysDiff === 3;
        });
        
        console.log(`\n✅ Found ${threeDaysPastDue.length} members exactly 3 days past due`);
        
        // Show sample of 3-days past due members
        if (threeDaysPastDue.length > 0) {
            console.log(`\nSample members (first 3):`);
            threeDaysPastDue.slice(0, 3).forEach((member, i) => {
                console.log(`  ${i + 1}. ${member.personal?.firstName} ${member.personal?.lastName}`);
                console.log(`     Email: ${member.personal?.email}`);
                console.log(`     Next Billing Date: ${member.agreement?.nextBillingDate}`);
                console.log(`     isPastDue flag: ${member.agreement?.isPastDue}`);
                console.log(`     Past Due Balance: $${member.agreement?.pastDueBalance || 0}`);
            });
        }
        
        return threeDaysPastDue;
        
    } catch (error) {
        console.error('Error fetching past due members from ABC:', error.message);
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
        
        // FILTER OUT non-PT services
        const filteredServices = services.filter(service => {
            const serviceItem = service.serviceItem || '';
            // Exclude these specific service items that are not PT
            const excludedServices = [
                'FULL ACCESS EUG SPRING',
                'ChildCare 1st Child',
                'ChildCare 2nd Child'
            ];
            return !excludedServices.includes(serviceItem);
        });
        
        console.log(`Fetched ${services.length} total services, filtered to ${filteredServices.length} (excluded: FULL ACCESS EUG SPRING, ChildCare services)`);
        return filteredServices;
        
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
                locationId: ghlLocationId,
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
async function syncContactToGHL(member, ghlApiKey, ghlLocationId, customTag = 'sale', serviceEmployee = null) {
    try {
        // Map ABC member data to GHL contact format
        const personal = member.personal || {};
        const agreement = member.agreement || {};
        
        const contactData = {
            locationId: ghlLocationId,
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
                { key: 'sale_team_member', value: agreement.salesPersonName || '' },
                { key: 'converted_date', value: agreement.convertedDate || '' },
                { key: 'member_sign_date', value: agreement.signDate || '' },
                { key: 'next_billing_date', value: agreement.nextBillingDate || '' },
                { key: 'is_past_due', value: agreement.isPastDue || '' },
                { key: 'total_check_in_count', value: personal.totalCheckInCount || '' },
                { key: 'last_check_in', value: personal.lastCheckInTimestamp || '' },
                ...(serviceEmployee ? [{ key: 'service_employee', value: serviceEmployee }] : []),
                ...(member.ptSignDate ? [{ key: 'pt_sign_date', value: member.ptSignDate }] : []),
                ...(member.ptDeactivateDate ? [{ key: 'pt_deactivate_date', value: member.ptDeactivateDate }] : [])
            ]
        };
        
        const headers = {
            'Authorization': `Bearer ${ghlApiKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        
        // First, search for existing contact by email using duplicate check endpoint
        let contactExists = false;
        let existingContactId = null;

        try {
            // Use GHL's duplicate check endpoint (more reliable)
            const searchUrl = `${GHL_API_URL}/contacts/search/duplicate`;
            const searchResponse = await axios.post(
                searchUrl,
                {
                    locationId: ghlLocationId,
                    email: contactData.email
                },
                { headers: headers }
            );
            
            // Check if we found the contact
            if (searchResponse.data && searchResponse.data.contact) {
                contactExists = true;
                existingContactId = searchResponse.data.contact.id;
                console.log(`Found existing contact: ${contactData.email} (ID: ${existingContactId})`);
            }
        } catch (searchError) {
            // If search fails, contact might not exist - we'll try to create
            console.log(`Contact search failed for ${contactData.email}, will try to create`);
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
                    
                    // Check if GHL provided the contactId in the error (phone duplicate case)
                    const duplicateContactId = createError.response?.data?.meta?.contactId;
                    
                    if (duplicateContactId) {
                        // GHL told us the exact contact ID - use it directly
                        try {
                            console.log(`Found duplicate contact ID from error: ${duplicateContactId}`);
                            
                            // Get the existing contact
                            const getUrl = `${GHL_API_URL}/contacts/${duplicateContactId}`;
                            const existingContact = await axios.get(getUrl, { headers: headers });
                            
                            // Get existing tags and add new tag
                            let existingTags = existingContact.data?.contact?.tags || [];
                            if (!existingTags.includes(customTag)) {
                                existingTags.push(customTag);
                            }
                            
                            const updateData = { ...contactData };
                            delete updateData.locationId; // Remove for update
                            updateData.tags = existingTags; // Use combined tags
                            
                            const updateUrl = `${GHL_API_URL}/contacts/${duplicateContactId}`;
                            const response = await axios.put(updateUrl, updateData, { headers: headers });
                            console.log(`✅ Updated duplicate contact (matched by ${createError.response?.data?.meta?.matchingField}): ${contactData.email}`);
                            return { action: 'updated', contact: response.data };
                        } catch (updateError) {
                            console.error(`Failed to update duplicate contact: ${updateError.message}`);
                        }
                    }
                    
                    // Fallback: Try a more thorough search
                    try {
                        const retrySearch = await axios.get(`${GHL_API_URL}/contacts/`, {
                            headers: headers,
                            params: { 
                                locationId: ghlLocationId,
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
        } // Close else block
        
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
 * @param {string} ghlApiKey - GHL API Key
 * @param {string} ghlLocationId - GHL Location ID
 * @param {string} customTag - Tag to add
 * @param {Array} customFields - Optional custom fields to update
 * @returns {Promise<Object>} GHL response
 */
async function addTagToContact(memberEmail, ghlApiKey, ghlLocationId, customTag, customFields = []) {
    try {
        const headers = {
            'Authorization': `Bearer ${ghlApiKey}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };
        
        // Search for contact by email
        const searchResponse = await axios.get(`${GHL_API_URL}/contacts/`, {
            headers: headers,
            params: { 
                locationId: ghlLocationId,
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
        
        // Prepare update data
        const updateData = {
            tags: existingTags
        };
        
        // Add custom fields if provided
        if (customFields && customFields.length > 0) {
            updateData.customFields = customFields;
        }
        
        // Update contact with new tag and custom fields
        const updateUrl = `${GHL_API_URL}/contacts/${exactMatch.id}`;
        const response = await axios.put(updateUrl, updateData, { headers: headers });
        
        console.log(`✅ Added '${customTag}' tag to contact: ${memberEmail}`);
        return { action: 'tagged', contact: response.data };
        
    } catch (error) {
        console.error(`Error adding tag to ${memberEmail}:`, error.message);
        throw new Error(`GHL API Error: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Fetch active employees from ABC
 * @param {string} clubNumber - The club number
 * @returns {Promise<Array>} Array of active employee names
 */
async function fetchEmployeesFromABC(clubNumber) {
    try {
        const url = `${ABC_API_URL}/${clubNumber}/employees`;
        
        console.log(`Fetching employees from ABC club ${clubNumber}...`);
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            }
        });
        
        const employees = response.data.employees || [];
        
        console.log(`Found ${employees.length} total employees from ABC`);
        
        // Filter for active employees and exclude bots/test accounts
        const excludedNames = [
            'easalytics bot', 'click2save bot', 'reporting bot', 
            'abc support', 'test test', 'personal trainer'
        ];
        
        const employeeNames = employees
            .filter(emp => {
                // Filter for active employees only
                const status = emp.employment?.employeeStatus?.toLowerCase();
                if (status !== 'active') return false;
                
                // Exclude bot/test accounts
                const fullName = `${emp.personal?.firstName || ''} ${emp.personal?.lastName || ''}`.toLowerCase().trim();
                if (excludedNames.includes(fullName)) return false;
                
                return true;
            })
            .map(emp => {
                const firstName = emp.personal?.firstName || '';
                const lastName = emp.personal?.lastName || '';
                return `${firstName} ${lastName}`.trim();
            })
            .filter(name => name.length > 0)
            .sort(); // Sort alphabetically
        
        console.log(`Filtered to ${employeeNames.length} active employees (excluding bots/test accounts)`);
        
        return employeeNames;
        
    } catch (error) {
        console.error('Error fetching employees from ABC:', error.message);
        if (error.response) {
            console.error('ABC API Response:', error.response.data);
        }
        throw new Error(`ABC API Error: ${error.response?.data?.message || error.message}`);
    }
}

/**
 * Update GHL custom field dropdown options
 * @param {string} locationId - GHL location ID
 * @param {string} fieldId - Custom field ID
 * @param {Array<string>} options - New dropdown options
 * @param {string} apiKey - GHL API key for this location
 * @returns {Promise<Object>} Result of the update
 */
async function updateGHLEmployeeDropdown(locationId, fieldId, options, apiKey) {
    try {
        // First, get the current field to preserve the name
        const getResponse = await axios.get(
            `https://services.leadconnectorhq.com/locations/${locationId}/customFields/${fieldId}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Version': '2021-07-28',
                    'Accept': 'application/json'
                }
            }
        );
        
        const currentField = getResponse.data.customField || getResponse.data;
        const fieldName = currentField.name || 'Tour Team Member';
        
        console.log(`Updating GHL field "${fieldName}" with ${options.length} options...`);
        
        // Update the field with new options
        const updateResponse = await axios.put(
            `https://services.leadconnectorhq.com/locations/${locationId}/customFields/${fieldId}`,
            {
                name: fieldName,
                options: options
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );
        
        return {
            success: true,
            fieldName: fieldName,
            optionsCount: options.length,
            options: options
        };
        
    } catch (error) {
        console.error('Error updating GHL dropdown:', error.message);
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
    const enabledClubs = clubsConfig.clubs.filter(c => c.enabled !== false);
    
    res.json({
        message: 'ABC to GHL Member Sync Server',
        status: 'running',
        features: {
            multiClubSync: 'Syncs all configured clubs at once',
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
            'POST /api/sync': 'Sync new members for ALL clubs (tag: sale)',
            'POST /api/sync-cancelled': 'Sync cancelled members (tag: cancelled / past member)',
            'POST /api/sync-past-due': 'Sync 3-day past due ACTIVE members (tag: past due)',
            'POST /api/sync-pt-new': 'Sync new PT services (tag: pt current)',
            'POST /api/sync-pt-deactivated': 'Sync deactivated PT (tag: ex pt)',
            'GET /api/test-abc': 'Test ABC API connection',
            'GET /api/test-ghl': 'Test GHL API connection',
            'GET /api/custom-fields/:clubNumber': 'List all custom fields for a location (find field IDs)'
        },
        configuration: {
            abc_api: ABC_APP_ID && ABC_APP_KEY ? 'configured' : 'NOT CONFIGURED',
            clubs_loaded: clubsConfig.clubs.length,
            clubs_enabled: enabledClubs.length,
            clubs: enabledClubs.map(c => ({ name: c.clubName, number: c.clubNumber }))
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
            locationId: ghlLocationId,
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
            locationId: ghlLocationId,
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
                locationId: ghlLocationId,
                keyPrefix: GHL_API_KEY.substring(0, 20) + '...',
                keyLength: GHL_API_KEY.length
            }
        };
        
        console.error('GHL API Test Failed:', JSON.stringify(errorDetails, null, 2));
        
        res.status(500).json(errorDetails);
    }
});

// Main sync endpoint - syncs ALL clubs at once
app.post('/api/sync', async (req, res) => {
    let { startDate, endDate } = req.body;
    
    // Validate required configuration
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({
            error: 'ABC API keys not configured',
            abc_app_id: ABC_APP_ID ? 'ok' : 'missing',
            abc_app_key: ABC_APP_KEY ? 'ok' : 'missing'
        });
    }
    
    if (!clubsConfig.clubs || clubsConfig.clubs.length === 0) {
        return res.status(500).json({
            error: 'No clubs configured in clubs-config.json'
        });
    }
    
    // Calculate last 3 days if no dates provided
if (!startDate && !endDate) {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() - 1); // Yesterday
    const start = new Date(today);
    start.setDate(start.getDate() - 3); // 3 days ago
    startDate = start.toISOString().split('T')[0];
    endDate = end.toISOString().split('T')[0];
    console.log(`Auto-set to last 3 days: ${startDate} to ${endDate}`);
}
    
    try {
        const results = {
            totalClubs: 0,
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
        
        // Process each enabled club
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        console.log(`\n🏢 Processing ${enabledClubs.length} clubs...`);
        
        for (const club of enabledClubs) {
            console.log(`\n=== Processing ${club.clubName} (${club.clubNumber}) ===`);
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                members: 0,
                created: 0,
                updated: 0,
                skipped: 0,
                skippedMembers: [],
                syncedMembers: [], // NEW: collect synced member details for CSV
                errors: [],
                startTime: new Date().toISOString()
            };
            
            try {
                // Fetch members from ABC
                const members = await fetchMembersFromABC(club.clubNumber, startDate, endDate);
                clubResult.members = members.length || 0;
                results.totalMembers += clubResult.members;
                
                console.log(`Fetched ${members.length} members from ABC`);
                
                // Sync each member to GHL using this club's credentials
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
                        
                        // Pass club-specific GHL credentials
                        const result = await syncContactToGHL(
                            member, 
                            club.ghlApiKey, 
                            club.ghlLocationId
                        );
                        
                        if (result.action === 'created') {
                            clubResult.created++;
                            results.created++;
                        } else if (result.action === 'updated') {
                            clubResult.updated++;
                            results.updated++;
                        }
                        
                        // Collect member details for CSV report
                        clubResult.syncedMembers.push({
                            name: `${member.personal?.firstName || ''} ${member.personal?.lastName || ''}`.trim(),
                            email: member.personal?.email || '',
                            phone: member.personal?.primaryPhone || member.personal?.mobilePhone || '',
                            action: result.action,
                            signDate: member.agreement?.signDate || '',
                            membershipType: member.agreement?.membershipType || ''
                        });
                        
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
        
        console.log('\n=== ALL CLUBS SYNC COMPLETE ===');
        console.log(`Total Clubs: ${results.totalClubs}`);
        console.log(`Total Members: ${results.totalMembers}`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Skipped: ${results.skipped}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Multi-club sync completed',
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
// Sync cancelled members - automatically syncs members who cancelled yesterday - ALL CLUBS
app.post('/api/sync-cancelled', async (req, res) => {
    let { startDate, endDate } = req.body;
    
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({
            error: 'ABC API keys not configured'
        });
    }
    
    if (!clubsConfig.clubs || clubsConfig.clubs.length === 0) {
        return res.status(500).json({
            error: 'No clubs configured in clubs-config.json'
        });
    }
    
    // Calculate last 3 days if no dates provided
if (!startDate && !endDate) {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() - 1); // Yesterday
    const start = new Date(today);
    start.setDate(start.getDate() - 3); // 3 days ago
    startDate = start.toISOString().split('T')[0];
    endDate = end.toISOString().split('T')[0];
    console.log(`Auto-set to last 3 days: ${startDate} to ${endDate}`);
}
    
    try {
        console.log(`\n🏢 Processing cancelled members for ${clubsConfig.clubs.filter(c => c.enabled !== false).length} clubs...`);
        
        const results = {
            type: 'cancelled_members',
            totalClubs: 0,
            dateRange: `${startDate} to ${endDate}`,
            totalMembers: 0,
            tagged: 0,
            alreadyTagged: 0,
            notFound: 0,
            errors: 0,
            clubs: []
        };
        
        // Process each enabled club
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        for (const club of enabledClubs) {
            console.log(`\n=== Processing ${club.clubName} (${club.clubNumber}) ===`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalMembers: 0,
                tagged: 0,
                alreadyTagged: 0,
                notFound: 0,
                errors: 0,
                members: []
            };
            
            try {
                // Fetch cancelled members
                const members = await fetchCancelledMembersFromABC(club.clubNumber, startDate, endDate);
                clubResult.totalMembers = members.length;
                results.totalMembers += members.length;
                
                console.log(`Found ${members.length} cancelled members`);
                
                // Tag each cancelled member in GHL using club-specific credentials
                for (const member of members) {
                    try {
                        const personal = member.personal || {};
                        const email = personal.email;
                        
                        if (!email) {
                            console.log(`⚠️ Skipping member without email: ${member.memberId}`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        // Prepare custom fields with cancel date
                        const customFields = [
                            { key: 'cancel_date', value: personal.memberStatusDate || '' }
                        ];
                        
                        // Add 'cancelled / past member' tag with cancel date
                        const result = await addTagToContact(email, club.ghlApiKey, club.ghlLocationId, 'cancelled / past member', customFields);
                        
                        if (result.action === 'tagged') {
                            clubResult.tagged++;
                            results.tagged++;
                        } else if (result.action === 'already_tagged') {
                            clubResult.alreadyTagged++;
                            results.alreadyTagged++;
                        } else if (result.action === 'not_found') {
                            clubResult.notFound++;
                            results.notFound++;
                        }
                        
                        clubResult.members.push({
                            email: email,
                            name: `${personal.firstName} ${personal.lastName}`,
                            cancelDate: personal.memberStatusDate,
                            cancelReason: personal.memberStatusReason,
                            action: result.action
                        });
                        
                    } catch (memberError) {
                        clubResult.errors++;
                        results.errors++;
                        console.error(`Error processing member: ${memberError.message}`);
                    }
                }
                
            } catch (clubError) {
                clubResult.errors++;
                results.errors++;
                console.error(`Error processing club ${club.clubName}:`, clubError.message);
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log(`\n=== ALL CLUBS - Cancelled Members Sync Complete ===`);
        console.log(`Total Clubs: ${results.totalClubs}`);
        console.log(`Total Members: ${results.totalMembers}`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Already Tagged: ${results.alreadyTagged}`);
        console.log(`Not Found: ${results.notFound}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Multi-club cancelled members sync completed',
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

// Sync past due members - sync active members exactly 3 days past due - ALL CLUBS
app.post('/api/sync-past-due', async (req, res) => {
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({
            error: 'ABC API keys not configured'
        });
    }
    
    if (!clubsConfig.clubs || clubsConfig.clubs.length === 0) {
        return res.status(500).json({
            error: 'No clubs configured in clubs-config.json'
        });
    }
    
    try {
        console.log(`\n🏢 Processing past due members for ${clubsConfig.clubs.filter(c => c.enabled !== false).length} clubs...`);
        
        const results = {
            type: 'past_due_members',
            totalClubs: 0,
            daysPastDue: 3,
            totalMembers: 0,
            tagged: 0,
            alreadyTagged: 0,
            notFound: 0,
            errors: 0,
            clubs: []
        };
        
        // Process each enabled club
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        for (const club of enabledClubs) {
            console.log(`\n=== Processing ${club.clubName} (${club.clubNumber}) ===`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalMembers: 0,
                tagged: 0,
                alreadyTagged: 0,
                notFound: 0,
                errors: 0,
                members: []
            };
            
            try {
                // Fetch members exactly 3 days past due
                const members = await fetchOneDayPastDueMembers(club.clubNumber);
                clubResult.totalMembers = members.length;
                results.totalMembers += members.length;
                
                console.log(`Found ${members.length} members 3 days past due`);
                
                // Tag each past due member in GHL using club-specific credentials
                for (const member of members) {
                    try {
                        const personal = member.personal || {};
                        const agreement = member.agreement || {};
                        const email = personal.email;
                        
                        if (!email) {
                            console.log(`⚠️ Skipping member without email: ${member.memberId}`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        // Add 'past due' tag with club-specific credentials
                        const result = await addTagToContact(email, club.ghlApiKey, club.ghlLocationId, 'past due');
                        
                        if (result.action === 'tagged') {
                            clubResult.tagged++;
                            results.tagged++;
                        } else if (result.action === 'already_tagged') {
                            clubResult.alreadyTagged++;
                            results.alreadyTagged++;
                        } else if (result.action === 'not_found') {
                            clubResult.notFound++;
                            results.notFound++;
                        }
                        
                        clubResult.members.push({
                            email: email,
                            name: `${personal.firstName} ${personal.lastName}`,
                            nextBillingDate: agreement.nextBillingDate,
                            pastDueBalance: agreement.pastDueBalance,
                            action: result.action
                        });
                        
                    } catch (memberError) {
                        clubResult.errors++;
                        results.errors++;
                        console.error(`Error processing member: ${memberError.message}`);
                    }
                }
                
            } catch (clubError) {
                clubResult.errors++;
                results.errors++;
                console.error(`Error processing club ${club.clubName}:`, clubError.message);
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log(`\n=== ALL CLUBS - Past Due Members Sync Complete ===`);
        console.log(`Total Clubs: ${results.totalClubs}`);
        console.log(`Total Members: ${results.totalMembers}`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Already Tagged: ${results.alreadyTagged}`);
        console.log(`Not Found: ${results.notFound}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Multi-club past due members sync completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Past due sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync new PT services - automatically syncs PT services sold yesterday - ALL CLUBS
app.post('/api/sync-pt-new', async (req, res) => {
    let { startDate, endDate } = req.body;
    
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({
            error: 'ABC API keys not configured'
        });
    }
    
    if (!clubsConfig.clubs || clubsConfig.clubs.length === 0) {
        return res.status(500).json({
            error: 'No clubs configured in clubs-config.json'
        });
    }
    
  // Calculate last 3 days if no dates provided
if (!startDate && !endDate) {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() - 1); // Yesterday
    const start = new Date(today);
    start.setDate(start.getDate() - 3); // 3 days ago
    startDate = start.toISOString().split('T')[0];
    endDate = end.toISOString().split('T')[0];
    console.log(`Auto-set to last 3 days: ${startDate} to ${endDate}`);
}
    
    try {
        console.log(`\n🏢 Processing new PT services for ${clubsConfig.clubs.filter(c => c.enabled !== false).length} clubs...`);
        
        const results = {
            type: 'new_pt_services',
            totalClubs: 0,
            dateRange: `${startDate} to ${endDate}`,
            totalServices: 0,
            created: 0,
            updated: 0,
            tagged: 0,
            errors: 0,
            clubs: []
        };
        
        // Process each enabled club
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        for (const club of enabledClubs) {
            console.log(`\n=== Processing ${club.clubName} (${club.clubNumber}) ===`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalServices: 0,
                created: 0,
                updated: 0,
                tagged: 0,
                errors: 0,
                services: []
            };
            
            try {
                // Fetch new recurring services (sold in date range) - no status filter to capture PIFs
                const services = await fetchRecurringServicesFromABC(club.clubNumber, startDate, endDate, null, 'sale');
                clubResult.totalServices = services.length;
                results.totalServices += services.length;
                
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
                        const member = await fetchMemberByIdFromABC(club.clubNumber, service.memberId);
                        
                        if (!member || !member.personal?.email) {
                            console.log(`⚠️ Member has no email, skipping`);
                            clubResult.errors++;
                            results.errors++;
                            clubResult.services.push({
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
                        
                        // Add pt_sign_date to member object for syncContactToGHL
                        member.ptSignDate = service.recurringServiceDates?.saleDate || '';
                        
                        // Determine tag based on service type
                        const ptTag = service.recurringServiceSubStatus === 'Paid in Full' ? 'pt pif' : 'pt current';
                        
                        // Create/update contact in GHL with appropriate tag and service employee using club-specific credentials
                        const result = await syncContactToGHL(member, club.ghlApiKey, club.ghlLocationId, ptTag, serviceEmployee || null);
                        
                        if (result.action === 'created') {
                            clubResult.created++;
                            results.created++;
                        } else if (result.action === 'updated') {
                            clubResult.updated++;
                            results.updated++;
                        }
                        clubResult.tagged++;
                        results.tagged++;
                        
                        clubResult.services.push({
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
                        clubResult.errors++;
                        results.errors++;
                        console.error(`❌ Error: ${serviceError.message}`);
                        clubResult.services.push({
                            memberId: service.memberId,
                            memberName: `${service.memberFirstName} ${service.memberLastName}`,
                            error: serviceError.message
                        });
                    }
                }
                
            } catch (clubError) {
                clubResult.errors++;
                results.errors++;
                console.error(`Error processing club ${club.clubName}:`, clubError.message);
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log(`\n=== ALL CLUBS - New PT Services Sync Complete ===`);
        console.log(`Total Clubs: ${results.totalClubs}`);
        console.log(`Total Services: ${results.totalServices}`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Multi-club new PT services sync completed',
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

// Sync deactivated PT services - automatically syncs PT services deactivated yesterday - ALL CLUBS
app.post('/api/sync-pt-deactivated', async (req, res) => {
    let { startDate, endDate } = req.body;
    
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({
            error: 'ABC API keys not configured'
        });
    }
    
    if (!clubsConfig.clubs || clubsConfig.clubs.length === 0) {
        return res.status(500).json({
            error: 'No clubs configured in clubs-config.json'
        });
    }
    
   // Calculate last 3 days if no dates provided
if (!startDate && !endDate) {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() - 1); // Yesterday
    const start = new Date(today);
    start.setDate(start.getDate() - 3); // 3 days ago
    startDate = start.toISOString().split('T')[0];
    endDate = end.toISOString().split('T')[0];
    console.log(`Auto-set to last 3 days: ${startDate} to ${endDate}`);
}
    
    try {
        console.log(`\n🏢 Processing deactivated PT services for ${clubsConfig.clubs.filter(c => c.enabled !== false).length} clubs...`);
        
        const results = {
            type: 'deactivated_pt_services',
            totalClubs: 0,
            dateRange: `${startDate} to ${endDate}`,
            totalServices: 0,
            created: 0,
            updated: 0,
            tagged: 0,
            errors: 0,
            clubs: []
        };
        
        // Process each enabled club
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        for (const club of enabledClubs) {
            console.log(`\n=== Processing ${club.clubName} (${club.clubNumber}) ===`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                totalServices: 0,
                created: 0,
                updated: 0,
                tagged: 0,
                errors: 0,
                services: []
            };
            
            try {
                // Fetch deactivated recurring services
                const services = await fetchRecurringServicesFromABC(club.clubNumber, startDate, endDate, 'Inactive', 'inactive');
                
                // Filter to only those deactivated in date range, excluding PIFs
                const deactivatedServices = services.filter(service => {
                    // Exclude PIFs - they don't use traditional deactivation
                    if (service.recurringServiceSubStatus === 'Paid in Full' || 
                        service.recurringTypeDesc === 'Paid in Full') {
                        return false;
                    }
                    
                    const inactiveDate = service.recurringServiceDates?.inactiveDate;
                    if (!inactiveDate) return false;
                    
                    const date = inactiveDate.split('T')[0];
                    return date >= startDate && date <= endDate;
                });
                
                clubResult.totalServices = deactivatedServices.length;
                results.totalServices += deactivatedServices.length;
                
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
                        const member = await fetchMemberByIdFromABC(club.clubNumber, service.memberId);
                        
                        if (!member || !member.personal?.email) {
                            console.log(`⚠️ Member has no email, skipping`);
                            clubResult.errors++;
                            results.errors++;
                            clubResult.services.push({
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
                        
                        // Add pt_deactivate_date to member object for syncContactToGHL
                        member.ptDeactivateDate = service.recurringServiceDates?.inactiveDate || '';
                        
                        // Create/update contact in GHL with 'ex pt' tag and service employee using club-specific credentials
                        const result = await syncContactToGHL(member, club.ghlApiKey, club.ghlLocationId, 'ex pt', serviceEmployee || null);
                        
                        if (result.action === 'created') {
                            clubResult.created++;
                            results.created++;
                        } else if (result.action === 'updated') {
                            clubResult.updated++;
                            results.updated++;
                        }
                        clubResult.tagged++;
                        results.tagged++;
                        
                        clubResult.services.push({
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
                        clubResult.errors++;
                        results.errors++;
                        console.error(`❌ Error: ${serviceError.message}`);
                        clubResult.services.push({
                            memberId: service.memberId,
                            memberName: `${service.memberFirstName} ${service.memberLastName}`,
                            error: serviceError.message
                        });
                    }
                }
                
            } catch (clubError) {
                clubResult.errors++;
                results.errors++;
                console.error(`Error processing club ${club.clubName}:`, clubError.message);
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log(`\n=== ALL CLUBS - Deactivated PT Services Sync Complete ===`);
        console.log(`Total Clubs: ${results.totalClubs}`);
        console.log(`Total Services: ${results.totalServices}`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Tagged: ${results.tagged}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Multi-club deactivated PT services sync completed',
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

// Sync completed PIF services - checks session balances and tags completed PIFs
app.post('/api/sync-pif-completed', async (req, res) => {
    // Validate configuration
    if (!ABC_APP_ID || !ABC_APP_KEY) {
        return res.status(500).json({
            error: 'ABC API keys not configured'
        });
    }
    
    if (!clubsConfig.clubs || clubsConfig.clubs.length === 0) {
        return res.status(500).json({
            error: 'No clubs configured in clubs-config.json'
        });
    }
    
    try {
        console.log(`\n🏢 Processing PIF completion check for ${clubsConfig.clubs.filter(c => c.enabled !== false).length} clubs...`);
        
        const results = {
            type: 'pif_completion',
            totalClubs: 0,
            totalChecked: 0,
            completed: 0,
            stillActive: 0,
            notFound: 0,
            errors: 0,
            clubs: []
        };
        
        // Process each enabled club
        const enabledClubs = clubsConfig.clubs.filter(club => club.enabled !== false);
        results.totalClubs = enabledClubs.length;
        
        for (const club of enabledClubs) {
            console.log(`\n=== Processing ${club.clubName} (${club.clubNumber}) ===`);
            
            const clubResult = {
                clubNumber: club.clubNumber,
                clubName: club.clubName,
                checked: 0,
                completed: 0,
                stillActive: 0,
                notFound: 0,
                errors: 0,
                members: []
            };
            
            try {
                // Get all GHL contacts with 'PT pif' tag using search endpoint
                const headers = {
                    'Authorization': `Bearer ${club.ghlApiKey}`,
                    'Version': '2021-07-28',
                    'Content-Type': 'application/json'
                };
                
                console.log('Fetching ALL GHL contacts with PT pif tag (paginated search)...');
                
                // Paginate through ALL contacts with PT pif tag
                let allPifContacts = [];
                let currentPage = 1;
                let hasMorePages = true;
                
                while (hasMorePages) {
                    const searchBody = {
                        locationId: club.ghlLocationId,
                        page: currentPage,
                        pageLimit: 100,
                        filters: [
                            {
                                field: "tags",
                                operator: "eq",
                                value: "pt pif"
                            }
                        ]
                    };
                    
                    const ghlResponse = await axios.post(`${GHL_API_URL}/contacts/search`, searchBody, { headers: headers });
                    
                    const contacts = ghlResponse.data.contacts || [];
                    allPifContacts = allPifContacts.concat(contacts);
                    
                    console.log(`  Page ${currentPage}: ${contacts.length} contacts with PT pif tag`);
                    
                    // Check if there are more pages
                    const meta = ghlResponse.data.meta || {};
                    const total = meta.total || 0;
                    const currentCount = allPifContacts.length;
                    
                    if (currentCount >= total || contacts.length === 0) {
                        hasMorePages = false;
                    } else {
                        currentPage++;
                    }
                    
                    // Safety limit: stop after 50 pages (5,000 contacts max per club)
                    if (currentPage > 50) {
                        console.log(`  ⚠️ Reached safety limit of 50 pages (5,000 contacts)`);
                        hasMorePages = false;
                    }
                }
                
                console.log(`Total PT pif contacts fetched: ${allPifContacts.length}`);
                
                const pifContacts = allPifContacts;
                
                console.log(`Found ${pifContacts.length} contacts with PT pif tag`);
                
                // Check each PIF contact's session balance
                for (const contact of pifContacts) {
                    try {
                        clubResult.checked++;
                        results.totalChecked++;
                        
                        // Fetch full contact details to get custom fields
                        console.log(`\nFetching full details for ${contact.firstName} ${contact.lastName}...`);
                        const fullContactResponse = await axios.get(`${GHL_API_URL}/contacts/${contact.id}`, { headers: headers });
                        const fullContact = fullContactResponse.data.contact || contact;
                        
                        // Get abc_member_id from custom fields
                        // ABC member IDs are 32-character hex strings (like "54c1774a5edc43a495747dfbdef6abd3")
                        let abcMemberId = null;
                        if (fullContact.customFields && Array.isArray(fullContact.customFields)) {
                            for (const field of fullContact.customFields) {
                                const value = field.value;
                                // Look for a 32-character hex string (ABC member ID pattern)
                                if (typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value)) {
                                    abcMemberId = value;
                                    console.log(`Found ABC Member ID: ${abcMemberId}`);
                                    break;
                                }
                            }
                        }
                        
                        if (!abcMemberId) {
                            console.log(`⚠️ No ABC Member ID for ${fullContact.email}`);
                            clubResult.notFound++;
                            results.notFound++;
                            continue;
                        }
                        
                        console.log(`Checking session balance for ${fullContact.firstName} ${fullContact.lastName} (${abcMemberId})`);
                        
                        // Fetch service purchase history from ABC
                        const abcUrl = `${ABC_API_URL}/${club.clubNumber}/members/${abcMemberId}/services/purchasehistory`;
                        const abcResponse = await axios.get(abcUrl, {
                            headers: {
                                'accept': 'application/json',
                                'app_id': ABC_APP_ID,
                                'app_key': ABC_APP_KEY
                            }
                        });
                        
                        const services = abcResponse.data.serviceSummaries || [];
                        
                        // Sum up available sessions across all PT services
                        let totalAvailable = 0;
                        services.forEach(service => {
                            const available = parseInt(service.available) || 0;
                            totalAvailable += available;
                        });
                        
                        console.log(`Total available sessions: ${totalAvailable}`);
                        
                        // If no sessions left, update tag to 'ex pt'
                        if (totalAvailable === 0) {
                            console.log(`✅ PIF completed - adding 'ex pt' tag`);
                            
                            // Keep 'pt pif' tag and add 'ex pt' tag
                            const updatedTags = [...fullContact.tags];
                            if (!updatedTags.includes('ex pt')) {
                                updatedTags.push('ex pt');
                            }
                            
                            await axios.put(`${GHL_API_URL}/contacts/${fullContact.id}`, {
                                tags: updatedTags
                            }, { headers: headers });
                            
                            clubResult.completed++;
                            results.completed++;
                            
                            clubResult.members.push({
                                email: fullContact.email,
                                name: `${fullContact.firstName} ${fullContact.lastName}`,
                                availableSessions: totalAvailable,
                                action: 'completed'
                            });
                        } else if (totalAvailable === 2) {
                            console.log(`⚠️ Only 2 sessions remaining - adding warning tag`);
                            
                            // Add '2 sessions left' tag if not already present
                            const updatedTags = [...fullContact.tags];
                            if (!updatedTags.includes('pt pif 2 sessions')) {
                                updatedTags.push('pt pif 2 sessions');
                                
                                await axios.put(`${GHL_API_URL}/contacts/${fullContact.id}`, {
                                    tags: updatedTags
                                }, { headers: headers });
                                
                                console.log(`✅ Added 'pt pif 2 sessions' tag`);
                            } else {
                                console.log(`Tag 'pt pif 2 sessions' already exists`);
                            }
                            
                            clubResult.stillActive++;
                            results.stillActive++;
                            
                            clubResult.members.push({
                                email: fullContact.email,
                                name: `${fullContact.firstName} ${fullContact.lastName}`,
                                availableSessions: totalAvailable,
                                action: 'low_sessions'
                            });
                        } else {
                            console.log(`Still has ${totalAvailable} sessions remaining`);
                            clubResult.stillActive++;
                            results.stillActive++;
                            
                            clubResult.members.push({
                                email: fullContact.email,
                                name: `${fullContact.firstName} ${fullContact.lastName}`,
                                availableSessions: totalAvailable,
                                action: 'still_active'
                            });
                        }
                        
                    } catch (memberError) {
                        clubResult.errors++;
                        results.errors++;
                        console.error(`Error checking member: ${memberError.message}`);
                    }
                }
                
            } catch (clubError) {
                clubResult.errors++;
                results.errors++;
                console.error(`Error processing club ${club.clubName}:`, clubError.message);
            }
            
            results.clubs.push(clubResult);
        }
        
        console.log(`\n=== ALL CLUBS - PIF Completion Check Complete ===`);
        console.log(`Total Clubs: ${results.totalClubs}`);
        console.log(`Total Checked: ${results.totalChecked}`);
        console.log(`Completed: ${results.completed}`);
        console.log(`Still Active: ${results.stillActive}`);
        console.log(`Not Found: ${results.notFound}`);
        console.log(`Errors: ${results.errors}`);
        
        res.json({
            success: true,
            message: 'Multi-club PIF completion check completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('PIF completion check error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sync employees from ABC to GHL dropdowns (Tour Team Member + Day One Booking Team Member)
app.post('/api/sync-employees', async (req, res) => {
    console.log('\n========================================');
    console.log('EMPLOYEE SYNC: ABC → GHL Dropdowns');
    console.log('(Tour Team Member + Day One Booking Team Member)');
    console.log('========================================');
    
    const results = {
        totalClubs: 0,
        synced: 0,
        skipped: 0,
        errors: 0,
        clubs: []
    };
    
    try {
        // Get enabled clubs that have at least one employee field ID configured
        const enabledClubs = clubsConfig.clubs.filter(club => 
            club.enabled !== false && (club.ghlEmployeeFieldId || club.ghlDayOneBookingFieldId)
        );
        results.totalClubs = enabledClubs.length;
        
        console.log(`Processing ${enabledClubs.length} enabled clubs with employee field(s) configured...`);
        
        for (const club of enabledClubs) {
            console.log(`\n--- Processing ${club.clubName} (${club.clubNumber}) ---`);
            
            const clubResult = {
                clubName: club.clubName,
                clubNumber: club.clubNumber,
                employees: [],
                employeeCount: 0,
                fieldsUpdated: [],
                status: 'pending',
                error: null
            };
            
            try {
                // 1. Fetch employees from ABC
                const employees = await fetchEmployeesFromABC(club.clubNumber);
                clubResult.employees = employees;
                clubResult.employeeCount = employees.length;
                
                if (employees.length === 0) {
                    console.log(`⚠️ No active employees found for ${club.clubName}`);
                    clubResult.status = 'skipped';
                    clubResult.error = 'No active employees found';
                    results.skipped++;
                } else {
                    // 2. Update Tour Team Member field (if configured)
                    if (club.ghlEmployeeFieldId) {
                        try {
                            await updateGHLEmployeeDropdown(
                                club.ghlLocationId,
                                club.ghlEmployeeFieldId,
                                employees,
                                club.ghlApiKey
                            );
                            console.log(`✅ Updated "Tour Team Member" with ${employees.length} employees`);
                            clubResult.fieldsUpdated.push('Tour Team Member');
                        } catch (fieldError) {
                            console.error(`❌ Error updating Tour Team Member field: ${fieldError.message}`);
                            clubResult.error = (clubResult.error || '') + `Tour Team Member: ${fieldError.message}; `;
                        }
                    }
                    
                    // 3. Update Day One Booking Team Member field (if configured)
                    if (club.ghlDayOneBookingFieldId) {
                        try {
                            await updateGHLEmployeeDropdown(
                                club.ghlLocationId,
                                club.ghlDayOneBookingFieldId,
                                employees,
                                club.ghlApiKey
                            );
                            console.log(`✅ Updated "Day One Booking Team Member" with ${employees.length} employees`);
                            clubResult.fieldsUpdated.push('Day One Booking Team Member');
                        } catch (fieldError) {
                            console.error(`❌ Error updating Day One Booking Team Member field: ${fieldError.message}`);
                            clubResult.error = (clubResult.error || '') + `Day One Booking Team Member: ${fieldError.message}; `;
                        }
                    }
                    
                    // Determine overall status
                    if (clubResult.fieldsUpdated.length > 0) {
                        clubResult.status = 'synced';
                        results.synced++;
                    } else {
                        clubResult.status = 'error';
                        results.errors++;
                    }
                }
                
            } catch (error) {
                console.error(`❌ Error syncing ${club.clubName}:`, error.message);
                clubResult.status = 'error';
                clubResult.error = error.message;
                results.errors++;
            }
            
            results.clubs.push(clubResult);
            
            // Small delay between clubs to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log('\n========================================');
        console.log('EMPLOYEE SYNC COMPLETE');
        console.log(`Synced: ${results.synced}, Skipped: ${results.skipped}, Errors: ${results.errors}`);
        console.log('========================================\n');
        
        res.json({
            success: true,
            message: 'Employee sync completed',
            results: results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Employee sync error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results: results
        });
    }
});

// Test endpoint to check ABC employee data structure
app.get('/api/test-employees/:clubNumber', async (req, res) => {
    const { clubNumber } = req.params;
    
    console.log(`Testing employee fetch for club ${clubNumber}...`);
    
    try {
        const url = `${ABC_API_URL}/${clubNumber}/employees`;
        
        const response = await axios.get(url, {
            headers: {
                'accept': 'application/json',
                'app_id': ABC_APP_ID,
                'app_key': ABC_APP_KEY
            }
        });
        
        const employees = response.data.employees || [];
        
        // Process and return summary
        const activeEmployees = employees.filter(emp => 
            emp.employment?.employeeStatus?.toLowerCase() === 'active'
        );
        
        res.json({
            success: true,
            totalEmployees: employees.length,
            activeEmployees: activeEmployees.length,
            activeNames: activeEmployees.map(emp => 
                `${emp.personal?.firstName || ''} ${emp.personal?.lastName || ''}`.trim()
            ).sort()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            response: error.response?.data
        });
    }
});

// Get all custom fields for a location (useful for finding field IDs)
app.get('/api/custom-fields/:clubNumber', async (req, res) => {
    const { clubNumber } = req.params;
    
    // Find the club config
    const club = clubsConfig.clubs.find(c => c.clubNumber === clubNumber);
    if (!club) {
        return res.status(404).json({ error: `Club ${clubNumber} not found in config` });
    }
    
    try {
        const response = await axios.get(
            `https://services.leadconnectorhq.com/locations/${club.ghlLocationId}/customFields`,
            {
                headers: {
                    'Authorization': `Bearer ${club.ghlApiKey}`,
                    'Version': '2021-07-28',
                    'Accept': 'application/json'
                }
            }
        );
        
        const fields = response.data.customFields || [];
        
        // Filter to just dropdowns and format nicely
        const dropdownFields = fields
            .filter(f => f.dataType === 'SINGLE_OPTIONS' || f.dataType === 'MULTIPLE_OPTIONS')
            .map(f => ({
                id: f.id,
                name: f.name,
                type: f.dataType,
                options: f.options || []
            }));
        
        res.json({
            clubName: club.clubName,
            clubNumber: club.clubNumber,
            totalFields: fields.length,
            dropdownFields: dropdownFields,
            allFields: fields.map(f => ({ id: f.id, name: f.name, type: f.dataType }))
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            response: error.response?.data
        });
    }
});

// Master sync endpoint - runs ALL syncs and sends one summary email
app.post('/api/sync-all', async (req, res) => {
    console.log('\n🚀 Starting Master Sync - All Endpoints');
    
    const masterResults = {
        startTime: new Date().toISOString(),
        endTime: null,
        totalDuration: null,
        syncs: {}
    };
    
    try {
        // 1. Sync new members (yesterday)
        console.log('\n📝 [1/7] Running new members sync...');
        try {
            const syncResponse = await axios.post(`http://localhost:${PORT}/api/sync`, {});
            masterResults.syncs.newMembers = {
                success: true,
                results: syncResponse.data.results
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
        console.log('\n📝 [2/7] Running cancelled members sync...');
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
        console.log('\n📝 [3/7] Running past due members sync...');
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
        console.log('\n📝 [4/7] Running new PT services sync...');
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
        console.log('\n📝 [5/7] Running deactivated PT services sync...');
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
        
        // 6. Check PIF completions
        console.log('\n📝 [6/7] Running PIF completion check...');
        try {
            const pifCompletedResponse = await axios.post(`http://localhost:${PORT}/api/sync-pif-completed`, {});
            masterResults.syncs.pifCompleted = {
                success: true,
                results: pifCompletedResponse.data.results
            };
            console.log('✅ PIF completion check complete');
        } catch (error) {
            masterResults.syncs.pifCompleted = {
                success: false,
                error: error.message
            };
            console.error('❌ PIF completion check failed:', error.message);
        }
        
        // 7. Sync employees to GHL dropdowns
        console.log('\n📝 [7/7] Running employee sync...');
        try {
            const employeeResponse = await axios.post(`http://localhost:${PORT}/api/sync-employees`, {});
            masterResults.syncs.employees = {
                success: true,
                results: employeeResponse.data.results
            };
            console.log('✅ Employee sync complete');
        } catch (error) {
            masterResults.syncs.employees = {
                success: false,
                error: error.message
            };
            console.error('❌ Employee sync failed:', error.message);
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
