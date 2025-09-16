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

const username = process.env.VTOP_USERNAME;
const password = process.env.VTOP_PASSWORD;

// Intent recognition using AI
async function recognizeIntent(message) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  
  const prompt = `
    You are an intent classifier for a VTOP (university portal) assistant.
    
    Available functions:
    - getCGPA: Get student's CGPA
    - getAttendance: Get attendance details
    - getMarks: Get marks/grades information
    - getAssignments: Get digital assignments
    - getTimetable: Get class schedule/timetable
    - general: General conversation or help
    
    User message: "${message}"
    
    Respond with ONLY the function name from the list above. No explanation needed.
    Examples:
    - "What's my CGPA?" -> getCGPA
    - "Show attendance" -> getAttendance  
    - "My marks please" -> getMarks
    - "My da upload deadlines" -> getAssignments
    - "What's my schedule?" -> getTimetable
    - "Hello" -> general
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
        
        Format the output like this style,no need for unnecessary explantions,whatever user asked just respond accordingly.keep it short:

📚 [Course Code] - [Course Name]
   📝 [Assessment Name] - [Score]/[Max] (Weightage: xx%) → xx%
      `;
      break;

    case 'getassignments':
      prompt = `
        The user asked: "${originalMessage}"
        Here's their assignments data: ${JSON.stringify(data, null, 2)}
        
        
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
      righnow u help functionalities to get help with
      view cgpa,view marks,check da deadlines,check atendance

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
async function loginToVTOP() {
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
    const success = await loginToVTOP();
    res.json({ success });
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
});