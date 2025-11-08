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
async function fetchMembersFromABC(
  clubNumber,
  startDate = null,
  endDate = null,
  activeStatus = 'Active',
  memberStatus = 'active'
) {
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
        accept: 'application/json',
        app_id: ABC_APP_ID,
        app_key: ABC_APP_KEY
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
 * Fetch cancelled/inactive members from ABC
 * @param {string} clubNumber - The club number
 * @param {string} startDate - Start date for memberStatusDate range
 * @param {string} endDate - End date for memberStatusDate range
 * @returns {Promise<Array>} Array of cancelled members
 */
async function fetchCancelledMembersFromABC(clubNumber, startDate, endDate) {
  try {
    const url = `${ABC_API_URL}/${clubNumber}/members`;

    const params = {
      activeStatus: 'Inactive',
      memberStatus: 'inactive'
    };

    // Use memberStatusDate range for when they became inactive
    if (startDate && endDate) {
      params.memberStatusDateRange = `${startDate},${endDate}`;
    }

    console.log(`Fetching cancelled members from ABC: ${url}`, params);

    const response = await axios.get(url, {
      headers: {
        accept: 'application/json',
        app_id: ABC_APP_ID,
        app_key: ABC_APP_KEY
      },
      params: params
    });

    const members = response.data.members || [];
    console.log(`Successfully fetched ${members.length} cancelled members from ABC`);
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
async function fetchRecurringServicesFromABC(
  clubNumber,
  startDate = null,
  endDate = null,
  serviceStatus = null,
  filterType = 'sale'
) {
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
        accept: 'application/json',
        app_id: ABC_APP_ID,
        app_key: ABC_APP_KEY
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
 * Add or update a contact in GoHighLevel
 * @param {Object} member - Member data from ABC
 * @param {string} customTag - Optional custom tag to add (default: 'sale')
 * @returns {Promise<Object>} GHL response
 */
async function syncContactToGHL(member, customTag = 'sale') {
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
        { key: 'last_check_in', value: personal.lastCheckInTimestamp || '' }
      ]
    };

    const headers = {
      Authorization: `Bearer ${GHL_API_KEY}`,
      Version: '2021-07-28',
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
      if (
        searchResponse.data &&
        searchResponse.data.contacts &&
        searchResponse.data.contacts.length > 0
      ) {
        // Find exact email match
        const exactMatch = searchResponse.data.contacts.find(
          (c) => c.email && c.email.toLowerCase() === contactData.email.toLowerCase()
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
        if (
          createError.response?.data?.message?.includes('duplicated') ||
          createError.response?.data?.message?.includes('duplicate')
        ) {
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
              console.log(
                `✅ Updated existing duplicate: ${contactData.email} (added '${customTag}' tag)`
              );
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
      Authorization: `Bearer ${GHL_API_KEY}`,
      Version: '2021-07-28',
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
      (c) => c.email && c.email.toLowerCase() === memberEmail.toLowerCase()
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
    const response = await axios.put(
      updateUrl,
      {
        tags: existingTags
      },
      { headers: headers }
    );

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
      'POST /api/sync': 'Sync new members (tag: sale)',
      'POST /api/sync-daily': 'Daily new member sync',
      'POST /api/sync-cancelled': 'Sync cancelled members (tag: cancelled / past member)',
      'POST /api/sync-pt-new': 'Sync new PT services (tag: pt current)',
      'POST /api/sync-pt-deactivated': 'Sync deactivated PT (tag: ex pt)',
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
      Authorization: `Bearer ${GHL_API_KEY}`,
      Version: '2021-07-28',
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
              console.log(
                `Skipping member ${member.personal?.email || member.memberId} - Membership type: ${membershipType}`
              );
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
      tagged: 0,
      alreadyTagged: 0,
      notFound: 0,
      errors: 0,
      services: []
    };

    // Fetch new recurring services (sold yesterday)
    const services = await fetchRecurringServicesFromABC(clubNumber, startDate, endDate, 'Active', 'sale');
    results.totalServices = services.length;

    console.log(`Found ${services.length} new PT services`);

    // Tag each member with new PT service
    for (const service of services) {
      try {
        // Need to find member email - we have memberId, firstName, lastName
        const memberEmail = `${service.memberFirstName}.${service.memberLastName}@example.com`.toLowerCase();

        // For now, we'll search by name if we don't have email in the service
        // In reality, we might need to make another API call to get member email
        console.log(
          `⚠️ Service for member: ${service.memberFirstName} ${service.memberLastName} (ID: ${service.memberId})`
        );

        // Try to add tag - this will search GHL for the contact
        const searchEmail =
          service.memberFirstName && service.memberLastName
            ? `${service.memberFirstName} ${service.memberLastName}`
            : service.memberId;

        const result = await addTagToContact(searchEmail, 'pt current');

        if (result.action === 'tagged') {
          results.tagged++;
        } else if (result.action === 'already_tagged') {
          results.alreadyTagged++;
        } else if (result.action === 'not_found') {
          results.notFound++;
        }

        results.services.push({
          memberId: service.memberId,
          memberName: `${service.memberFirstName} ${service.memberLastName}`,
          serviceItem: service.serviceItem,
          saleDate: service.recurringServiceDates?.saleDate,
          salesPerson: `${service.salesPersonFirstName} ${service.salesPersonLastName}`,
          action: result.action
        });
      } catch (serviceError) {
        results.errors++;
        console.error(`Error processing PT service: ${serviceError.message}`);
      }
    }

    console.log(`\n=== New PT Services Sync Complete ===`);
    console.log(`Tagged: ${results.tagged}`);
    console.log(`Already Tagged: ${results.alreadyTagged}`);
    console.log(`Not Found: ${results.notFound}`);
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
      tagged: 0,
      alreadyTagged: 0,
      notFound: 0,
      errors: 0,
      services: []
    };

    // Fetch deactivated recurring services
    const services = await fetchRecurringServicesFromABC(clubNumber, startDate, endDate, 'Inactive', 'inactive');

    // Filter to only those deactivated in date range
    const deactivatedServices = services.filter((service) => {
      const inactiveDate = service.recurringServiceDates?.inactiveDate;
      if (!inactiveDate) return false;

      const date = inactiveDate.split('T')[0];
      return date >= startDate && date <= endDate;
    });

    results.totalServices = deactivatedServices.length;

    console.log(`Found ${deactivatedServices.length} deactivated PT services`);

    // Tag each member with deactivated PT service
    for (const service of deactivatedServices) {
      try {
        const searchEmail =
          service.memberFirstName && service.memberLastName
            ? `${service.memberFirstName} ${service.memberLastName}`
            : service.memberId;

        const result = await addTagToContact(searchEmail, 'ex pt');

        if (result.action === 'tagged') {
          results.tagged++;
        } else if (result.action === 'already_tagged') {
          results.alreadyTagged++;
        } else if (result.action === 'not_found') {
          results.notFound++;
        }

        results.services.push({
          memberId: service.memberId,
          memberName: `${service.memberFirstName} ${service.memberLastName}`,
          serviceItem: service.serviceItem,
          inactiveDate: service.recurringServiceDates?.inactiveDate,
          deactivateReason: service.recurringServiceDates?.deactivateReason,
          action: result.action
        });
      } catch (serviceError) {
        results.errors++;
        console.error(`Error processing deactivated PT: ${serviceError.message}`);
      }
    }

    console.log(`\n=== Deactivated PT Services Sync Complete ===`);
    console.log(`Tagged: ${results.tagged}`);
    console.log(`Already Tagged: ${results.alreadyTagged}`);
    console.log(`Not Found: ${results.notFound}`);
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
