require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { chromium } = require('playwright');
const { solveUsingViboot } = require('./captcha/captchaSolver');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global variables to store browser and page instances
let globalBrowser = null;
let globalPage = null;
let isLoggedIn = false;
let currentCredentials = {
  username: null,
  password: null,
  isDemo: false
};

// Sample credentials from .env for demo purposes
const demoUsername = process.env.VTOP_USERNAME;
const demoPassword = process.env.VTOP_PASSWORD;

// Intent recognition using AI
async function recognizeIntent(message) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
const prompt = `
  You are an advanced intent classifier for a VTOP (VIT University portal) assistant.
  Analyze the user's message and determine their primary intent.
  
  Available functions:
  - getCGPA: CGPA queries, GPA questions, overall academic performance
  - getAttendance: Attendance percentage, classes attended, debar status, attendance records
  - getMarks: Marks, grades, scores, test results, exam performance, CAT marks, FAT marks
  - getAssignments: Digital assignments, DA deadlines, assignment uploads, submission dates
  - getLoginHistory: Login history, session history, login records, access logs
  - getTimetable: Class schedule, timetable, class timings (not implemented yet)
  - general: Greetings, help requests, general conversation, unclear requests
  
  Intent Detection Rules:
  - Look for keywords: CGPA, GPA, grade point → getCGPA
  - Look for keywords: attendance, classes, present, absent, debar → getAttendance  
  - Look for keywords: marks, grades, scores, CAT, FAT, exam, test → getMarks
  - Look for keywords: assignment, DA, deadline, upload, submission → getAssignments
  - Look for keywords: login history, session, access log, login records → getLoginHistory
  - Look for keywords: timetable, schedule, timing, classes today → getTimetable
  - Casual conversation, greetings, help → general
  
  User message: "${message}"
  
  Examples:
  - "What's my current CGPA?" → getCGPA
  - "How's my attendance looking?" → getAttendance  
  - "Show me my CAT 1 marks" → getMarks
  - "Any pending DA submissions?" → getAssignments
  - "Show my login history" → getLoginHistory
  - "What are my class timings?" → getTimetable
  - "Hello, how are you?" → general
  - "Help me with VTOP" → general
  
  Respond with ONLY the function name. No explanations or additional text.
`;

  try {
    const result = await model.generateContent(prompt);
    const intent = result.response.text().trim().toLowerCase();
    return intent;
  } catch (error) {
    console.error('Error in intent recognition:', error);
    return 'general';
  }
}

// Response generation using AI
async function generateResponse(intent, data, originalMessage) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  let prompt = '';
  
  // Add demo mode context to responses
  
  
  switch (intent) {
    case 'getcgpa':
      prompt = `
        The user asked: "${originalMessage}"
        Their CGPA is: ${data}
        
        Generate a friendly, encouraging response about their CGPA. Keep it conversational and positive.
        Include the CGPA value and maybe a motivational comment.
        
      `;
      break;
      
    case 'getattendance':
      prompt = `
        The user asked: "${originalMessage}"
        Here's their attendance data: ${JSON.stringify(data, null, 2)}
        
        Format the output like this style:

    📚 [Course Code] - [Course Name]
      ✅ Attendance: [attended]/[total] classes
      📊 Percentage: [xx%]
      🚫 Debar Status: [status]

      Only output in this structured multi-line format, no extra explanation.
      `;
      break;
      
    case 'getmarks':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their marks data: ${JSON.stringify(data, null, 2)}
    
    Format the output like this:
    
    📚 [1] BCSE310L - IoT Architectures and Protocols
       📝 CAT-1:  25/50  | Weight: 7.5/15
       📝 Quiz-1: 10/10  | Weight: 10/10 
    
    📚 [2] BCSE312L - Programming for IoT Boards
       📝 Assessment-1: 10/20   | Weight: 5/10
    
    FIELD MAPPING:
    - Use course.slNo for numbering [1], [2], etc.
    - Use course.courseCode - course.courseTitle for subject line
    - Use course.marks[].title for assessment name
    - Format: course.marks[].scored/course.marks[].max  | Weight: course.marks[].weightage/course.marks[].percent
    
    RULES:
    1. Start each course with "📚 [slNo] courseCode - courseTitle"
    2. Each assessment: "   📝 title: scored/max  | Weight: weightage/percent%"
    3. Use exactly 3 spaces before each assessment line
    4. Add blank line between courses
    5. If no marks, show "   📊 No marks available"
    6. Keep it concise - no extra text
  `;
  break;


    case 'getassignments':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their assignments data: ${JSON.stringify(data, null, 2)}
    
    Format the output EXACTLY like this structure:
    
    📋 DIGITAL ASSIGNMENTS - ALL SUBJECTS
    ============================================================
    📚 [1] BCSE310L - IoT Architectures and Protocols
       📝 [1] Course Project - Due: 25-Sep-2025
    
    📚 [2] BCSE312L - Programming for IoT Boards
       📝 [1] Course Based Design Project - Due: 07-Nov-2025
    
    FIELD MAPPING FROM JSON DATA:
    - For subject line: "📚 [subject.slNo] subject.courseCode - subject.courseTitle"
    - For assignment line: "   📝 [assignment.slNo] assignment.title - Due: assignment.dueDate"
    
    FORMATTING RULES:
    1. Start with "📋 DIGITAL ASSIGNMENTS - ALL SUBJECTS(If user asked for one or two subjects then write this accordingly)"
    2. Add a line of 60 equals signs (=)(if more than one subject then only do this)
    3. For each subject in subjects array: "📚 [slNo] courseCode - courseTitle"
    4. For each assignment in subject.assignments: "   📝 [slNo] title - Due: dueDate"
    5. Use exactly 3 spaces before each assignment line
    6. Add blank line between subjects
    7. If subject.assignments is empty, show "   ⏳ No assignments found"
    8. If assignment.dueDate is empty or "-", just show "Due: -"
    
    Use the EXACT field names from the JSON data. Follow this format precisely.
  `;
  break;

  case 'getloginhistory':
  prompt = `
    The user asked: "${originalMessage}"
    Here's their login history data: ${data}
    
    Format the output like this:
    
    🕐 LOGIN HISTORY
    ============================================================
    
    [Display the login history data in a clean, readable format]
    
    Keep it simple,tabular and organized.
  `;
  break;


      
    case 'gettimetable':
      prompt = `
        The user asked: "${originalMessage}"
        Timetable feature is not yet implemented.
        
        Generate a helpful response explaining that timetable feature is coming soon,
        and suggest they can ask about CGPA, attendance, or marks instead.
      `;
      break;
      
    default:
  prompt = `
  So u r a vtop chatbot.
  right now u help functionalities to get help with
  view cgpa, view marks, check da deadlines, check attendance, view login history

  this is user's msg  "${originalMessage}"

  answer it accordingly
  `;

  }

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error('Error generating response:', error);
    return "I'm having trouble generating a response right now. Please try again.";
  }
}

// Helper functions from your original code
async function getAuthData(page) {
  return await page.evaluate(() => {
    const csrfToken = document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
                     document.querySelector('input[name="_csrf"]')?.value;
    const regNumMatch = document.body.textContent.match(/\b\d{2}[A-Z]{3}\d{4}\b/g);
    const authorizedID = regNumMatch ? regNumMatch[0] : null;
    
    return { csrfToken, authorizedID };
  });
}

async function getCGPAAjax(page) {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/get/dashboard/current/cgpa/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `authorizedID=${authorizedID}&_csrf=${csrfToken}&x=${new Date().toUTCString()}`);

  let cgpaMatch = response.match(/<span.*?>([0-9.]+)<\/span>/g);
  let cgpa = cgpaMatch ? cgpaMatch[2]?.match(/>([0-9.]+)</)?.[1] : null;
  
  console.log('🌟 Your CGPA is:', cgpa);
  return cgpa;
}

async function getLoginHistoryAjax(page) {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/show/login/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `_csrf=${csrfToken}&authorizedID=${authorizedID}&x=${new Date().toUTCString()}`);

  // Extract just the text content without HTML tags
  const textContent = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  }, response);

  return textContent;
}

async function getAttendanceAjax(page, semesterSubId = 'VL20252601') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/processViewStudentAttendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `_csrf=${csrfToken}&semesterSubId=${semesterSubId}&authorizedID=${authorizedID}&x=${new Date().toUTCString()}`);

  const attendanceData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const rows = Array.from(tempDiv.querySelectorAll('#AttendanceDetailDataTable tbody tr'));
    
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      const attendanceCell = cells[7];
      let attendancePercentage = '';
      if (attendanceCell) {
        const span = attendanceCell.querySelector('span span');
        attendancePercentage = span ? span.innerText.trim() : attendanceCell.innerText.trim();
      }
      
      return {
        slNo: cells[0]?.innerText.trim() || '',
        courseDetail: cells[2]?.innerText.trim() || '',
        attendedClasses: cells[5]?.innerText.trim() || '',
        totalClasses: cells[6]?.innerText.trim() || '',
        attendancePercentage,
        debarStatus: cells[8]?.innerText.trim() || ''
      };
    }).filter(item => item.slNo);
  }, response);

  return attendanceData;
}

async function getMarkViewAjax(page, semesterSubId = 'VL20252601') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/doStudentMarkView', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `_csrf=${csrfToken}&semesterSubId=${semesterSubId}&authorizedID=${authorizedID}&x=${new Date().toUTCString()}`);

  const marksData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const rows = Array.from(tempDiv.querySelectorAll('tbody tr'));
    
    const courses = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.classList.contains('tableContent') || row.querySelector('.customTable-level1')) continue;
      
      const cells = row.querySelectorAll('td');
      const course = {
        slNo: cells[0]?.innerText.trim(),
        courseCode: cells[2]?.innerText.trim(),
        courseTitle: cells[3]?.innerText.trim(),
        faculty: cells[6]?.innerText.trim(),
        slot: cells[7]?.innerText.trim(),
        marks: []
      };
      
      const nextRow = rows[i + 1];
      const marksTable = nextRow?.querySelector('.customTable-level1 tbody');
      if (marksTable) {
        course.marks = Array.from(marksTable.querySelectorAll('tr.tableContent-level1')).map(markRow => {
          const outputs = markRow.querySelectorAll('output');
          return {
            title: outputs[1]?.innerText.trim(),
            scored: outputs[5]?.innerText.trim(),
            max: outputs[2]?.innerText.trim(),
            weightage: outputs[6]?.innerText.trim(),
            percent: outputs[3]?.innerText.trim()
          };
        });
        i++;
      }
      courses.push(course);
    }
    return courses;
  }, response);

  return marksData;
}

async function getDigitalAssignmentAjax(page, semesterSubId = 'VL20252601') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  const subjectsResponse = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/doDigitalAssignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `authorizedID=${authorizedID}&x=${new Date().toUTCString()}&semesterSubId=${semesterSubId}&_csrf=${csrfToken}`);

  const subjectsData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const rows = Array.from(tempDiv.querySelectorAll('tbody tr.tableContent'));
    
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      return {
        slNo: cells[0]?.innerText.trim() || '',
        classNbr: cells[1]?.innerText.trim() || '',
        courseCode: cells[2]?.innerText.trim() || '',
        courseTitle: cells[3]?.innerText.trim() || ''
      };
    }).filter(item => item.slNo && item.classNbr);
  }, subjectsResponse);

  // For each subject, get assignments
  for (const subject of subjectsData) {
    try {
      const assignmentsResponse = await page.evaluate(async (payloadString) => {
        const res = await fetch('/vtop/examinations/processDigitalAssignment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: payloadString
        });
        return await res.text();
      }, `_csrf=${csrfToken}&classId=${subject.classNbr}&authorizedID=${authorizedID}&x=${new Date().toUTCString()}`);

      const assignmentData = await page.evaluate((html) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        const tables = Array.from(tempDiv.querySelectorAll('table.customTable'));
        const assignmentTable = tables[1];
        if (!assignmentTable) return [];
        
        const rows = Array.from(assignmentTable.querySelectorAll('tbody tr.tableContent'));
        
        return rows.map(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 5) return null;
          
          return {
            slNo: cells[0]?.innerText.trim() || '',
            title: cells[1]?.innerText.trim() || '',
            dueDate: cells[4]?.querySelector('span')?.innerText.trim() || cells[4]?.innerText.trim() || ''
          };
        }).filter(item => item && item.slNo && item.slNo !== 'Sl.No.');
      }, assignmentsResponse);

      subject.assignments = assignmentData;
    } catch (error) {
      subject.assignments = [];
    }
  }

  return { subjects: subjectsData };
}

async function solveCaptcha(page) {
  await page.waitForSelector('img.form-control.img-fluid.bg-light.border-0', { timeout: 10000 });
  
  const captchaDataUrl = await page.evaluate(() => {
    const img = document.querySelector('img.form-control.img-fluid.bg-light.border-0');
    return img ? img.src : null;
  });

  let captchaBuffer;

  if (captchaDataUrl && captchaDataUrl.startsWith('data:image')) {
    const base64Data = captchaDataUrl.split(',')[1];
    captchaBuffer = Buffer.from(base64Data, 'base64');
  }

  console.log('🧠 Solving with ViBoOT neural network...');
  const result = await solveUsingViboot(captchaBuffer);
  
  console.log('✅ ViBoOT CAPTCHA result:', result);
  await page.fill('#captchaStr', result);
  return result;
}

// VTOP Login Function
async function loginToVTOP(username, password) {
  try {
    if (globalBrowser) {
      await globalBrowser.close();
    }

    globalBrowser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });

    globalPage = await globalBrowser.newPage();
    globalPage.setDefaultTimeout(240000);

    console.log('🔍 Logging into VTOP...');
    await globalPage.goto('https://vtop.vit.ac.in/vtop/login');
    await globalPage.waitForSelector('#stdForm', { timeout: 10000 });
    await globalPage.click('#stdForm button[type="submit"]');
    await globalPage.waitForLoadState('networkidle');
    await globalPage.waitForSelector('#username');

    await globalPage.fill('#username', username);
    await globalPage.fill('#password', password);

    let captchaFound = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!captchaFound && attempts < maxAttempts) {
      try {
        const captchaElement = await globalPage.$('img.form-control.img-fluid.bg-light.border-0');
        if (captchaElement) {
          console.log(`✅ CAPTCHA found on attempt ${attempts + 1}`);
          captchaFound = true;
          await solveCaptcha(globalPage);
        } else {
          console.log(`❌ No CAPTCHA found, reloading... (attempt ${attempts + 1}/${maxAttempts})`);
          await globalPage.reload();
          await globalPage.waitForLoadState('networkidle');
          await globalPage.waitForSelector('#username');
          await globalPage.fill('#username', username);
          await globalPage.fill('#password', password);
          attempts++;
        }
      } catch (error) {
        console.log(`❌ Error checking CAPTCHA, reloading... (attempt ${attempts + 1}/${maxAttempts})`);
        await globalPage.reload();
        await globalPage.waitForLoadState('networkidle');
        await globalPage.waitForSelector('#username');
        await globalPage.fill('#username', username);
        await globalPage.fill('#password', password);
        attempts++;
      }
    }

    if (!captchaFound) {
      throw new Error('CAPTCHA not found after maximum attempts');
    }

    let loginSuccess = false;
    let captchaAttempts = 0;
    const maxCaptchaAttempts = 3;

    while (!loginSuccess && captchaAttempts < maxCaptchaAttempts) {
      captchaAttempts++;
      console.log(`🔄 CAPTCHA attempt ${captchaAttempts}/${maxCaptchaAttempts}`);
      
      console.log('⏩ Now clicking submit...');
      await globalPage.click('button:has-text("Submit")');
      
      try {
        await globalPage.waitForLoadState('networkidle', { timeout: 30000 });

        loginSuccess = await globalPage.evaluate(() => {
          return Array.from(document.querySelectorAll('.card-header.primaryBorderTop span'))
            .some(span => span.textContent && span.textContent.includes('CGPA and CREDIT Status'));
        });

        if (loginSuccess) {
          console.log('🎉 LOGIN SUCCESSFUL!');
          isLoggedIn = true;
          return true;
        }

        const backAtLogin = await globalPage.$('#username');
        if (backAtLogin && captchaAttempts < maxCaptchaAttempts) {
          console.log(`❌ Invalid CAPTCHA - page reloaded (attempt ${captchaAttempts})`);
          console.log('🔄 Trying again with new CAPTCHA...');
          
          await globalPage.fill('#username', username);
          await globalPage.fill('#password', password);
          
          await solveCaptcha(globalPage);
        } else {
          console.log('❌ LOGIN FAILED - unknown error');
          break;
        }

      } catch (error) {
        console.log('❌ Error during login attempt:', error.message);
        break;
      }
    }

    return false;

  } catch (error) {
    console.error('❌ Error during login:', error.message);
    return false;
  }
}

// API Routes
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, useDemo } = req.body;
    
    let loginUsername, loginPassword;
    
    if (useDemo) {
      // Use demo credentials
      loginUsername = demoUsername;
      loginPassword = demoPassword;
      currentCredentials = {
        username: loginUsername,
        password: loginPassword,
        isDemo: true
      };
    } else {
      // Use provided credentials
      if (!username || !password) {
        return res.status(400).json({ 
          success: false, 
          error: 'Username and password are required when not using demo mode' 
        });
      }
      loginUsername = username;
      loginPassword = password;
      currentCredentials = {
        username: loginUsername,
        password: loginPassword,
        isDemo: false
      };
    }

    const success = await loginToVTOP(loginUsername, loginPassword);
    res.json({ 
      success, 
      isDemo: currentCredentials.isDemo,
      message: success ? 
        (currentCredentials.isDemo ? 'Successfully logged in with demo account' : 'Successfully logged in with your credentials') :
        'Login failed'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!isLoggedIn || !globalPage) {
      return res.status(400).json({ 
        response: "I'm not connected to VTOP right now. Please refresh the page to reconnect.",
        data: null 
      });
    }

    // Recognize intent
    const intent = await recognizeIntent(message);
    console.log('Recognized intent:', intent);

    let data = null;
    let response = '';

    // Execute appropriate function based on intent
    switch (intent) {
      case 'getcgpa':
        try {
          data = await getCGPAAjax(globalPage);
          response = await generateResponse(intent, data, message);
        } catch (error) {
          response = "Sorry, I couldn't fetch your CGPA right now. Please try again.";
        }
        break;

      case 'getattendance':
        try {
          data = await getAttendanceAjax(globalPage);
          response = await generateResponse(intent, data, message);
        } catch (error) {
          response = "Sorry, I couldn't fetch your attendance data right now. Please try again.";
        }
        break;

      case 'getmarks':
        try {
          data = await getMarkViewAjax(globalPage);
          response = await generateResponse(intent, data, message);
        } catch (error) {
          response = "Sorry, I couldn't fetch your marks right now. Please try again.";
        }
        break;

      case 'getassignments':
        try {
          data = await getDigitalAssignmentAjax(globalPage);
          response = await generateResponse(intent, data, message);
        } catch (error) {
          response = "Sorry, I couldn't fetch your assignments right now. Please try again.";
        }
        break;

        case 'getloginhistory':
  try {
    data = await getLoginHistoryAjax(globalPage);
    response = await generateResponse(intent, data, message);
  } catch (error) {
    response = "Sorry, I couldn't fetch your login history right now. Please try again.";
  }
  break;

      case 'gettimetable':
        response = await generateResponse(intent, null, message);
        break;

      default:
        response = await generateResponse(intent, null, message);
        break;
    }

    res.json({ response, data });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      response: "I encountered an error processing your request. Please try again.",
      data: null 
    });
  }
});

// Get current session info
app.get('/api/session', (req, res) => {
  res.json({
    isLoggedIn,
    isDemo: currentCredentials.isDemo,
    hasCredentials: !!currentCredentials.username
  });
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
  try {
    if (globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
      globalPage = null;
    }
    isLoggedIn = false;
    currentCredentials = {
      username: null,
      password: null,
      isDemo: false
    };
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  if (globalBrowser) {
    await globalBrowser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  if (globalBrowser) {
    await globalBrowser.close();
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 VTOP Chat Backend running on port ${PORT}`);
  console.log(`📱 Frontend available at http://localhost:${PORT}`);
  console.log(`🎭 Demo mode available: ${demoUsername ? 'Yes' : 'No'}`);
});