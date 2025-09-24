//test-login-simple.js
require('dotenv').config();
const { chromium } = require('playwright');
const { solveUsingViboot } = require('./captcha/captchaSolver');
const path = require('path');


const username = process.env.VTOP_USERNAME;
const password = process.env.VTOP_PASSWORD;

// ===== HELPER FUNCTIONS =====
async function getAuthData(page) {
  return await page.evaluate(() => {
    const csrfToken = document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
                     document.querySelector('input[name="_csrf"]')?.value;
    const regNumMatch = document.body.textContent.match(/\b\d{2}[A-Z]{3}\d{4}\b/g);
    const authorizedID = regNumMatch ? regNumMatch[0] : null;
    
    return { csrfToken, authorizedID };
  });
}

// ===== SCRAPING FUNCTIONS =====
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

  // Print attendance data nicely
  console.log('\n📊 ATTENDANCE SUMMARY:');
  console.log('='.repeat(80));
 
  attendanceData.forEach(({ slNo, courseDetail, attendedClasses, totalClasses, attendancePercentage, debarStatus }) => {
    console.log(`\n[${slNo}] ${courseDetail}`);
    console.log(`    Attended: ${attendedClasses}/${totalClasses} classes`);
    console.log(`    Percentage: ${attendancePercentage}`);
    console.log(`    Debar Status: ${debarStatus}`);
  });

  console.log('\n' + '='.repeat(80));

  return attendanceData;
}
async function getTimetableAjax(page, semesterSubId = 'VL20252601') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  // First, get course registration data to build course name mapping
  let courseMapping = {};
  try {
    const registrationResponse = await page.evaluate(async (payloadString) => {
      const res = await fetch('/vtop/academics/common/CourseRegistration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payloadString
      });
      return await res.text();
    }, `verifyMenu=true&authorizedID=${authorizedID}&_csrf=${csrfToken}&semesterSubId=${semesterSubId}`);

    // Extract course names from registration page
    courseMapping = await page.evaluate((html) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      const courseRows = Array.from(tempDiv.querySelectorAll('tbody tr'));
      const mapping = {};
      
      courseRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length > 2) {
          const courseCell = cells[2]; // Course column
          const courseText = courseCell.textContent.trim();
          const match = courseText.match(/^([A-Z0-9]+L?)\s*-\s*(.+)/);
          if (match) {
            const [, courseCode, courseName] = match;
            mapping[courseCode] = courseName.split('(')[0].trim(); // Remove "(Theory Only)" part
          }
        }
      });
      return mapping;
    }, registrationResponse);
    
    console.log('📚 Course mapping loaded:', Object.keys(courseMapping).length, 'courses found');
  } catch (error) {
    console.log('⚠️ Could not load course names, showing codes only');
  }
  
  // First request to access timetable page
  const verifyResponse = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/academics/common/StudentTimeTable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `verifyMenu=true&authorizedID=${authorizedID}&_csrf=${csrfToken}`);

  // Second request to get timetable data
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/processViewTimeTable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `_csrf=${csrfToken}&semesterSubId=${semesterSubId}&authorizedID=${authorizedID}`);

  const timetableData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Find the timetable table
    const table = tempDiv.querySelector('#timeTableStyle tbody');
    if (!table) return { schedule: [], timeSlots: {} };
    
    const rows = Array.from(table.querySelectorAll('tr'));
    const schedule = {};
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    
    // Initialize schedule structure
    days.forEach(day => {
      schedule[day] = {
        theory: [],
        lab: []
      };
    });
    
    let currentDay = '';
    let isTheory = true;
    
    // Process each row
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      
      // Skip header rows (time slots)
      if (cells.length > 0 && (
        cells[0].textContent.includes('THEORY') || 
        cells[0].textContent.includes('LAB') ||
        cells[0].textContent.includes('Start') ||
        cells[0].textContent.includes('End')
      )) {
        return;
      }
      
      // Check if this is a day row
      const firstCell = cells[0];
      if (firstCell && days.includes(firstCell.textContent.trim())) {
        currentDay = firstCell.textContent.trim();
        
        // Check if this is theory or lab row
        const secondCell = cells[1];
        isTheory = secondCell && secondCell.textContent.includes('THEORY');
        
        // Process the schedule cells (skip first 2 cells - day and type)
        const scheduleCells = Array.from(cells).slice(2);
        const scheduleSlots = [];
        
        scheduleCells.forEach((cell, index) => {
          const content = cell.textContent.trim();
          
          // Skip lunch and empty cells
          if (content === 'Lunch' || content === '-' || content === '') {
            scheduleSlots.push({ slot: index, content: null, type: 'empty' });
            return;
          }
          
          // Check if cell has course information (colored cells with course codes)
          const bgColor = cell.getAttribute('bgcolor') || cell.style.backgroundColor;
          if (bgColor === '#FC6C85' || content.includes('-')) {
            // Parse course information like "A1-BCSE406L-TH-SJT508-ALL"
            const parts = content.split('-');
            if (parts.length >= 4) {
              scheduleSlots.push({
                slot: index,
                slotCode: parts[0],
                courseCode: parts[1],
                courseType: parts[2],
                venue: parts[3],
                section: parts[4] || 'ALL',
                type: 'course'
              });
            } else {
              scheduleSlots.push({
                slot: index,
                content: content,
                type: 'other'
              });
            }
          } else {
            // Regular slot codes like "B1", "L25", etc.
            scheduleSlots.push({
              slot: index,
              content: content,
              type: 'slot'
            });
          }
        });
        
        if (currentDay && schedule[currentDay]) {
          if (isTheory) {
            schedule[currentDay].theory = scheduleSlots;
          } else {
            schedule[currentDay].lab = scheduleSlots;
          }
        }
      }
    });
    
    return schedule;
  }, response);

  // Print timetable data nicely
  console.log('\n📅 WEEKLY TIMETABLE:');
  console.log('='.repeat(80));
  
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const timeSlots = [
    '08:00-08:50', '09:00-09:50', '10:00-10:50', '11:00-11:50', 
    '12:00-12:50', 'LUNCH', '14:00-14:50', '15:00-15:50', 
    '16:00-16:50', '17:00-17:50', '18:00-18:50', '18:51-19:00', '19:01-19:50'
  ];
  
  days.forEach(day => {
    if (timetableData[day]) {
      console.log(`\n🗓️  ${day}:`);
      console.log('-'.repeat(40));
      
      // Theory classes
      console.log('  📚 THEORY:');
      const theoryCourses = timetableData[day].theory.filter(slot => slot.type === 'course');
      if (theoryCourses.length > 0) {
        theoryCourses.forEach(course => {
          const timeSlot = timeSlots[course.slot] || `Slot ${course.slot}`;
          console.log(`    ${timeSlot}: ${course.courseCode} - ${course.courseName}`);
          console.log(`      Slot: ${course.slotCode} | Venue: ${course.venue}`);
        });
      } else {
        console.log('    No theory classes');
      }
      
      // Lab classes
      console.log('  🔬 LAB:');
      const labCourses = timetableData[day].lab.filter(slot => slot.type === 'course');
      if (labCourses.length > 0) {
        labCourses.forEach(course => {
          const timeSlot = timeSlots[course.slot] || `Slot ${course.slot}`;
          console.log(`    ${timeSlot}: ${course.courseCode} - ${course.courseName}`);
          console.log(`      Slot: ${course.slotCode} | Venue: ${course.venue}`);
        });
      } else {
        console.log('    No lab classes');
      }
    }
  });

  console.log('\n' + '='.repeat(80));
  
  return timetableData;
}
async function getExamScheduleAjax(page, semesterSubId = 'VL20252601') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  // First request to access exam schedule page
  const verifyResponse = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/StudExamSchedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `verifyMenu=true&authorizedID=${authorizedID}&_csrf=${csrfToken}&nocache=${new Date().toUTCString()}`);

  // Second request to get exam schedule data
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/doSearchExamScheduleForStudent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `authorizedID=${authorizedID}&_csrf=${csrfToken}&semesterSubId=${semesterSubId}`);

  const examData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const rows = Array.from(tempDiv.querySelectorAll('tbody tr.tableContent'));
    
    const examSchedule = {
      FAT: [],
      CAT2: [],
      CAT1: []
    };
    
    let currentExamType = '';
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      
      // Check if this is an exam type header row
      if (cells.length === 1 && cells[0].classList.contains('panelHead-secondary')) {
        currentExamType = cells[0].innerText.trim();
        return;
      }
      
      // Skip if not enough cells or if it's a header row
      if (cells.length < 13 || !currentExamType) return;
      
      const examInfo = {
        slNo: cells[0]?.innerText.trim() || '',
        courseCode: cells[1]?.innerText.trim() || '',
        courseTitle: cells[2]?.innerText.trim() || '',
        courseType: cells[3]?.innerText.trim() || '',
        classId: cells[4]?.innerText.trim() || '',
        slot: cells[5]?.innerText.trim() || '',
        examDate: cells[6]?.innerText.trim() || '',
        examSession: cells[7]?.innerText.trim() || '',
        reportingTime: cells[8]?.innerText.trim() || '',
        examTime: cells[9]?.innerText.trim() || '',
        venue: cells[10]?.querySelector('span')?.innerText.trim() || cells[10]?.innerText.trim() || '-',
        seatLocation: cells[11]?.querySelector('span')?.innerText.trim() || cells[11]?.innerText.trim() || '-',
        seatNo: cells[12]?.querySelector('span')?.innerText.trim() || cells[12]?.innerText.trim() || '-'
      };
      
      // Only add if we have valid data
      if (examInfo.slNo && examInfo.courseCode) {
        if (currentExamType === 'FAT') {
          examSchedule.FAT.push(examInfo);
        } else if (currentExamType === 'CAT2') {
          examSchedule.CAT2.push(examInfo);
        } else if (currentExamType === 'CAT1') {
          examSchedule.CAT1.push(examInfo);
        }
      }
    });
    
    return examSchedule;
  }, response);

  // Print exam schedule data nicely
  console.log('\n📅 EXAM SCHEDULE:');
  console.log('='.repeat(80));
  
  ['FAT', 'CAT2', 'CAT1'].forEach(examType => {
    if (examData[examType] && examData[examType].length > 0) {
      console.log(`\n🎯 ${examType} EXAMS:`);
      console.log('-'.repeat(50));
      
      examData[examType].forEach(exam => {
        console.log(`\n[${exam.slNo}] ${exam.courseCode} - ${exam.courseTitle}`);
        console.log(`    📅 Date: ${exam.examDate} | Session: ${exam.examSession}`);
        console.log(`    ⏰ Time: ${exam.examTime} | Reporting: ${exam.reportingTime}`);
        console.log(`    🏢 Venue: ${exam.venue} | Seat: ${exam.seatLocation}-${exam.seatNo}`);
        console.log(`    📚 Slot: ${exam.slot} | Type: ${exam.courseType}`);
      });
    } else {
      console.log(`\n🎯 ${examType} EXAMS: No exams scheduled`);
    }
  });

  console.log('\n' + '='.repeat(80));
  
  return examData;
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

  // Print marks data nicely
  console.log('\n📊 MARKS SUMMARY:');
  console.log('='.repeat(80));
 
  marksData.forEach(({ slNo, courseCode, courseTitle, faculty, slot, marks }) => {
    console.log(`\n[${slNo}] ${courseCode} - ${courseTitle}`);
    console.log(`    Faculty: ${faculty} | Slot: ${slot}`);
    if (marks && marks.length > 0) {
      marks.forEach(mark => {
        console.log(`    📝 ${mark.title}: ${mark.scored}/${mark.max} | Weight: ${mark.weightage}/${mark.percent}%`);
      });
    } else {
      console.log('    📊 No marks available');
    }
  });

  console.log('\n' + '='.repeat(80));

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

  // Print assignments data nicely
  console.log('\n📋 DIGITAL ASSIGNMENTS SUMMARY:');
  console.log('='.repeat(80));
 
  subjectsData.forEach(({ slNo, courseCode, courseTitle, assignments }) => {
    console.log(`\n[${slNo}] ${courseCode} - ${courseTitle}`);
    if (assignments && assignments.length > 0) {
      assignments.forEach(assignment => {
        console.log(`    📝 [${assignment.slNo}] ${assignment.title} - Due: ${assignment.dueDate}`);
      });
    } else {
      console.log('    ⏳ No assignments found');
    }
  });

  console.log('\n' + '='.repeat(80));

  return { subjects: subjectsData };
}

async function scrapeTimeTable(page) {
  console.log('\n📅 Navigating to Time Table page...');

  // Click on timetable link
  const clicked = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).filter(
      e => e.dataset?.url?.includes('academics/common/StudentTimeTable')
    );
    if (links.length > 0) {
      links[0].click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log('❌ Time Table link not found.');
    return;
  }

  await page.waitForLoadState('networkidle');
  await page.waitForSelector('select#semesterSubId', { timeout: 15000 });

  // Select semester
  await page.selectOption('select#semesterSubId', 'VL20252601');
  console.log('✅ Semester selected.');

  // Wait for any table rows
  await page.waitForSelector('table tbody tr', { timeout: 15000 });

  const timetable = await page.evaluate(() => {
    const table = document.querySelector('table tbody');
    if (!table) return [];

    const rows = Array.from(table.querySelectorAll('tr'));
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      return {
        day: cells[0]?.innerText.trim() || '',
        slot: cells[1]?.innerText.trim() || '',
        courseCode: cells[2]?.innerText.trim() || '',
        courseTitle: cells[3]?.innerText.trim() || '',
        faculty: cells[4]?.innerText.trim() || '',
        venue: cells[5]?.innerText.trim() || ''
      };
    }).filter(r => r.day && r.courseCode);
  });

  // Print full weekly timetable
  console.log('\n📅 Weekly Timetable:');
  timetable.forEach(({ day, slot, courseCode, courseTitle, faculty, venue }) => {
    console.log(`\n${day} - [${slot}]`);
    console.log(`   ${courseCode} - ${courseTitle}`);
    console.log(`   Faculty: ${faculty} | Venue: ${venue}`);
  });

  return timetable;
}

// ===== CAPTCHA SOLVER =====
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

// ===== MAIN FUNCTION =====
async function testVtopLogin() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(240000);

  try {
    console.log('🔍 Testing VTOP login...');
    await page.goto('https://vtop.vit.ac.in/vtop/login');
    await page.waitForSelector('#stdForm', { timeout: 10000 });
    await page.click('#stdForm button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#username');

    await page.fill('#username', username);
    await page.fill('#password', password);

    let captchaFound = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!captchaFound && attempts < maxAttempts) {
      try {
        const captchaElement = await page.$('img.form-control.img-fluid.bg-light.border-0');
        if (captchaElement) {
          console.log(`✅ CAPTCHA found on attempt ${attempts + 1}`);
          captchaFound = true;
          await solveCaptcha(page);
        } else {
          console.log(`❌ No CAPTCHA found, reloading... (attempt ${attempts + 1}/${maxAttempts})`);
          await page.reload();
          await page.waitForLoadState('networkidle');
          await page.waitForSelector('#username');
          await page.fill('#username', username);
          await page.fill('#password', password);
          attempts++;
        }
      } catch (error) {
        console.log(`❌ Error checking CAPTCHA, reloading... (attempt ${attempts + 1}/${maxAttempts})`);
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('#username');
        await page.fill('#username', username);
        await page.fill('#password', password);
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
     
      console.log('✅ Captcha entered, waiting 1 seconds before submitting...');
      await page.waitForTimeout(1000);

      console.log('⏩ Now clicking submit...');
      await page.click('button:has-text("Submit")');
     
      try {
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        await page.waitForTimeout(3000);

        loginSuccess = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.card-header.primaryBorderTop span'))
            .some(span => span.textContent && span.textContent.includes('CGPA and CREDIT Status'));
        });

        if (loginSuccess) {
          console.log('🎉 LOGIN SUCCESSFUL!');
          console.log('Current URL:', await page.url());

          // ===== COMPREHENSIVE DATA EXTRACTION =====
          console.log('\n🚀 Starting comprehensive data extraction...');
         
          // Extract CGPA using AJAX
          console.log('\n🌟 Fetching CGPA...');
          await getCGPAAjax(page);

          // // Extract Login History
          // console.log('\n🕐 Fetching Login History...');
          // const loginHistory = await getLoginHistoryAjax(page);
          // console.log('Login History:', loginHistory);

          // Extract Attendance using AJAX
          // console.log('\n📊 Fetching Attendance...');
          // await getAttendanceAjax(page);

          await getTimetableAjax(page);

          // console.log('\n📊 Fetching scedule...');

          // await getExamScheduleAjax(page);

          // // Extract Marks using AJAX
          // console.log('\n📝 Fetching Marks...');
          // await getMarkViewAjax(page);

          // // Extract Digital Assignments using AJAX
          // console.log('\n📋 Fetching Digital Assignments...');
          // await getDigitalAssignmentAjax(page);

          // Extract Timetable
          // console.log('\n📅 Fetching Timetable...');
          // // await scrapeTimeTable(page);

          console.log('\n✅ All data extraction completed!');
          break;
        }

        const backAtLogin = await page.$('#username');
        if (backAtLogin && captchaAttempts < maxCaptchaAttempts) {
          console.log(`❌ Invalid CAPTCHA - page reloaded (attempt ${captchaAttempts})`);
          console.log('🔄 Trying again with new CAPTCHA...');
         
          await page.fill('#username', username);
          await page.fill('#password', password);
         
          await solveCaptcha(page);
        } else {
          console.log('❌ LOGIN FAILED - unknown error');
          break;
        }

      } catch (error) {
        console.log('❌ Error during login attempt:', error.message);
        break;
      }
    }

    if (!loginSuccess) {
      console.log(`❌ LOGIN FAILED after ${maxCaptchaAttempts} CAPTCHA attempts`);
    }

    await browser.close();
    return loginSuccess;

  } catch (error) {
    console.error('❌ Error during login test:', error.message);
    await browser.close();
    return false;
  }
}

// ===== RUN THE SCRIPT =====
testVtopLogin().then(success => {
  console.log('Final result - Login success:', success);
});