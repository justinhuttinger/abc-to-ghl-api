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

// Create email transporter
let emailTransporter = null;
if (EMAIL_USER && EMAIL_PASS) {
    console.log('📧 Email Config:');
    console.log('   Host:', EMAIL_HOST);
    console.log('   Port:', EMAIL_PORT);
    console.log('   User:', EMAIL_USER);
    console.log('   Pass:', EMAIL_PASS ? 'Set (length: ' + EMAIL_PASS.length + ')' : 'NOT SET');
    
    emailTransporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: false,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS
        }
    });
    console.log('✅ Email notifications enabled');
} else {
    console.log('⚠️ Email notifications disabled (EMAIL_USER/EMAIL_PASS not configured)');
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
    if (!emailTransporter) {
        console.log('Email notifications disabled, skipping...');
        return;
    }
    
    try {
        let html = `
            <h2>${subject}</h2>
            <p><strong>Status:</strong> ${success ? '✅ SUCCESS' : '❌ FAILED'}</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <hr>
        `;
        
        if (success) {
            html += `
                <h3>Summary</h3>
                <ul>
                    <li><strong>Total Clubs:</strong> ${results.totalClubs || 'N/A'}</li>
                    <li><strong>Total Members/Services:</strong> ${results.totalMembers || results.totalServices || 0}</li>
                    <li><strong>Created:</strong> ${results.created || 0}</li>
                    <li><strong>Updated:</strong> ${results.updated || 0}</li>
                    <li><strong>Tagged:</strong> ${results.tagged || 0}</li>
                    <li><strong>Already Tagged:</strong> ${results.alreadyTagged || 0}</li>
                    <li><strong>Skipped:</strong> ${results.skipped || 0}</li>
                    <li><strong>Not Found:</strong> ${results.notFound || 0}</li>
                    <li><strong>Errors:</strong> ${results.errors || 0}</li>
                </ul>
                
                <h3>Per-Club Results</h3>
            `;
            
            if (results.clubs && results.clubs.length > 0) {
                results.clubs.forEach(club => {
                    html += `
                        <h4>${club.clubName} (${club.clubNumber})</h4>
                        <ul>
                            <li>Members/Services: ${club.members || club.totalMembers || club.totalServices || 0}</li>
                            <li>Created: ${club.created || 0}</li>
                            <li>Updated: ${club.updated || 0}</li>
                            <li>Tagged: ${club.tagged || 0}</li>
                            <li>Errors: ${club.errors || (Array.isArray(club.errors) ? club.errors.length : 0)}</li>
                        </ul>
                    `;
                });
            }
            
            if (results.dateRange) {
                html += `<p><strong>Date Range:</strong> ${results.dateRange}</p>`;
            }
            
        } else {
            html += `
                <h3>Error Details</h3>
                <p>${results.error || 'Unknown error occurred'}</p>
                <pre>${JSON.stringify(results, null, 2)}</pre>
            `;
        }
        
        await emailTransporter.sendMail({
            from: `"WCS Sync Server" <${EMAIL_USER}>`,
            to: NOTIFICATION_EMAIL,
            subject: subject,
            html: html
        });
        
        console.log(`📧 Email notification sent to ${NOTIFICATION_EMAIL}`);
        
    } catch (error) {
        console.error('Failed to send email notification:', error.message);
    }
}

/**
 * Send master sync email with results from all endpoints
 */
async function sendMasterSyncEmail(masterResults, success = true) {
    if (!emailTransporter) {
        console.log('Email notifications disabled, skipping...');
        return;
    }
    
    try {
        let html = `
            <h1>🚀 Daily WCS Sync Report</h1>
            <p><strong>Status:</strong> ${success ? '✅ ALL SYNCS COMPLETE' : '❌ SOME SYNCS FAILED'}</p>
            <p><strong>Start Time:</strong> ${masterResults.startTime}</p>
            <p><strong>End Time:</strong> ${masterResults.endTime}</p>
            <p><strong>Total Duration:</strong> ${masterResults.totalDuration}</p>
            <hr>
        `;
        
        // 1. New Members
        if (masterResults.syncs.newMembers) {
            const sync = masterResults.syncs.newMembers;
            html += `
                <h2>1️⃣ New Members Sync</h2>
                <p><strong>Status:</strong> ${sync.success ? '✅ Success' : '❌ Failed'}</p>
            `;
            if (sync.success) {
                const r = sync.results;
                html += `
                    <ul>
                        <li><strong>Total Clubs:</strong> ${r.totalClubs}</li>
                        <li><strong>Total Members:</strong> ${r.totalMembers}</li>
                        <li><strong>Created:</strong> ${r.created}</li>
                        <li><strong>Updated:</strong> ${r.updated}</li>
                        <li><strong>Skipped:</strong> ${r.skipped}</li>
                        <li><strong>Errors:</strong> ${r.errors}</li>
                        <li><strong>Date Range:</strong> ${r.dateRange}</li>
                    </ul>
                `;
            } else {
                html += `<p style="color: red;">Error: ${sync.error}</p>`;
            }
        }
        
        // 2. Cancelled Members
        if (masterResults.syncs.cancelledMembers) {
            const sync = masterResults.syncs.cancelledMembers;
            html += `
                <h2>2️⃣ Cancelled Members Sync</h2>
                <p><strong>Status:</strong> ${sync.success ? '✅ Success' : '❌ Failed'}</p>
            `;
            if (sync.success) {
                const r = sync.results;
                html += `
                    <ul>
                        <li><strong>Total Clubs:</strong> ${r.totalClubs}</li>
                        <li><strong>Total Members:</strong> ${r.totalMembers}</li>
                        <li><strong>Tagged:</strong> ${r.tagged}</li>
                        <li><strong>Already Tagged:</strong> ${r.alreadyTagged}</li>
                        <li><strong>Not Found:</strong> ${r.notFound}</li>
                        <li><strong>Errors:</strong> ${r.errors}</li>
                    </ul>
                `;
            } else {
                html += `<p style="color: red;">Error: ${sync.error}</p>`;
            }
        }
        
        // 3. Past Due Members
        if (masterResults.syncs.pastDueMembers) {
            const sync = masterResults.syncs.pastDueMembers;
            html += `
                <h2>3️⃣ Past Due Members Sync (3 Days)</h2>
                <p><strong>Status:</strong> ${sync.success ? '✅ Success' : '❌ Failed'}</p>
            `;
            if (sync.success) {
                const r = sync.results;
                html += `
                    <ul>
                        <li><strong>Total Clubs:</strong> ${r.totalClubs}</li>
                        <li><strong>Total Members:</strong> ${r.totalMembers}</li>
                        <li><strong>Tagged:</strong> ${r.tagged}</li>
                        <li><strong>Already Tagged:</strong> ${r.alreadyTagged}</li>
                        <li><strong>Not Found:</strong> ${r.notFound}</li>
                        <li><strong>Errors:</strong> ${r.errors}</li>
                    </ul>
                `;
            } else {
                html += `<p style="color: red;">Error: ${sync.error}</p>`;
            }
        }
        
        // 4. New PT Services
        if (masterResults.syncs.newPTServices) {
            const sync = masterResults.syncs.newPTServices;
            html += `
                <h2>4️⃣ New PT Services Sync</h2>
                <p><strong>Status:</strong> ${sync.success ? '✅ Success' : '❌ Failed'}</p>
            `;
            if (sync.success) {
                const r = sync.results;
                html += `
                    <ul>
                        <li><strong>Total Clubs:</strong> ${r.totalClubs}</li>
                        <li><strong>Total Services:</strong> ${r.totalServices}</li>
                        <li><strong>Created:</strong> ${r.created}</li>
                        <li><strong>Updated:</strong> ${r.updated}</li>
                        <li><strong>Tagged:</strong> ${r.tagged}</li>
                        <li><strong>Errors:</strong> ${r.errors}</li>
                    </ul>
                `;
            } else {
                html += `<p style="color: red;">Error: ${sync.error}</p>`;
            }
        }
        
        // 5. Deactivated PT Services
        if (masterResults.syncs.deactivatedPTServices) {
            const sync = masterResults.syncs.deactivatedPTServices;
            html += `
                <h2>5️⃣ Deactivated PT Services Sync</h2>
                <p><strong>Status:</strong> ${sync.success ? '✅ Success' : '❌ Failed'}</p>
            `;
            if (sync.success) {
                const r = sync.results;
                html += `
                    <ul>
                        <li><strong>Total Clubs:</strong> ${r.totalClubs}</li>
                        <li><strong>Total Services:</strong> ${r.totalServices}</li>
                        <li><strong>Created:</strong> ${r.created}</li>
                        <li><strong>Updated:</strong> ${r.updated}</li>
                        <li><strong>Tagged:</strong> ${r.tagged}</li>
                        <li><strong>Errors:</strong> ${r.errors}</li>
                    </ul>
                `;
            } else {
                html += `<p style="color: red;">Error: ${sync.error}</p>`;
            }
        }
        
        html += `
            <hr>
            <p style="color: #666; font-size: 12px;">
                This is an automated report from your WCS Sync Server.<br>
                Report generated at ${new Date().toLocaleString()}
            </p>
        `;
        
        await emailTransporter.sendMail({
            from: `"WCS Sync Server" <${EMAIL_USER}>`,
            to: NOTIFICATION_EMAIL,
            subject: success ? `✅ Daily Sync Complete - ${masterResults.totalDuration}` : `❌ Daily Sync Failed`,
            html: html
        });
        
        console.log(`📧 Master sync email sent to ${NOTIFICATION_EMAIL}`);
        
    } catch (error) {
        console.error('Failed to send master sync email:', error.message);
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
        
        // FILTER OUT 'FULL ACCESS EUG SPRING' - this is NOT a PT service
        const filteredServices = services.filter(service => {
            return service.serviceItem !== 'FULL ACCESS EUG SPRING';
        });
        
        console.log(`Fetched ${services.length} total services, filtered to ${filteredServices.length} (excluded 'FULL ACCESS EUG SPRING')`);
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
            'Authorization': `Bearer ${ghlApiKey}`,
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
                    locationId: ghlLocationId,
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
async function addTagToContact(memberEmail, ghlApiKey, ghlLocationId, customTag) {
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
        
        // Update contact with new tag
        const updateUrl = `${ghlApiKey}/contacts/${exactMatch.id}`;
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
            'GET /api/test-ghl': 'Test GHL API connection'
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
    
    // AUTO-CALCULATE YESTERDAY'S DATE if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`No dates provided. Auto-set to yesterday: ${startDate}`);
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
    
    // Calculate yesterday if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`Auto-set to yesterday: ${startDate}`);
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
                        
                        // Add 'cancelled / past member' tag with club-specific credentials
                        const result = await addTagToContact(email, club.ghlApiKey, club.ghlLocationId, 'cancelled / past member');
                        
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
    
    // Calculate yesterday if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`Auto-set to yesterday: ${startDate}`);
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
                // Fetch new recurring services (sold in date range)
                const services = await fetchRecurringServicesFromABC(club.clubNumber, startDate, endDate, 'Active', 'sale');
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
                        
                        // Create/update contact in GHL with 'pt current' tag and service employee using club-specific credentials
                        const result = await syncContactToGHL(member, club.ghlApiKey, club.ghlLocationId, 'pt current', serviceEmployee || null);
                        
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
    
    // Calculate yesterday if no dates provided
    if (!startDate && !endDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = yesterday.toISOString().split('T')[0];
        endDate = startDate;
        console.log(`Auto-set to yesterday: ${startDate}`);
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
                
                // Filter to only those deactivated in date range
                const deactivatedServices = services.filter(service => {
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
        console.log('\n📝 [1/5] Running new members sync...');
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
