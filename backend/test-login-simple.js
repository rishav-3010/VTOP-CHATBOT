//test-login-simple4.js
require('dotenv').config();
const { chromium } = require('playwright');
const { solveUsingViboot } = require('./captcha/captchaSolver');
const path = require('path');
const fs = require('fs');

const username = process.env.VTOP_USERNAME;
const password = process.env.VTOP_PASSWORD;




// Get CSRF token and student ID (reusable helper)
async function getAuthData(page) {
  return await page.evaluate(() => {
    const csrfToken = document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
                     document.querySelector('input[name="_csrf"]')?.value;
    const regNumMatch = document.body.textContent.match(/\b\d{2}[A-Z]{3}\d{4}\b/g);
    const authorizedID = regNumMatch ? regNumMatch[0] : null;
    
    return { csrfToken, authorizedID };
  });
}

// Login History Function
// Login History Function
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

  console.log('\n🕐 LOGIN HISTORY\n' + '='.repeat(40));
  console.log(textContent);

  return textContent;
}
// CGPA Function
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

  const cgpaMatch = response.match(/<span.*?>([0-9.]+)<\/span>/g);
  const cgpa = cgpaMatch ? cgpaMatch[2]?.match(/>([0-9.]+)</)?.[1] : null;
  
  console.log('🌟 Your CGPA is:', cgpa);
  return cgpa;
}

// Attendance Function
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

  console.log('\n📊 ATTENDANCE SUMMARY:');
  attendanceData.forEach(({ slNo, courseDetail, attendedClasses, totalClasses, attendancePercentage }) => {
    console.log(`[${slNo}] ${courseDetail}: ${attendedClasses}/${totalClasses} (${attendancePercentage})`);
  });

  return attendanceData;
}

// Mark View Function //VL20242505
async function getMarkViewAjax(page, semesterSubId = 'VL20242505') {
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
        i++; // Skip marks table row
      }
      courses.push(course);
    }
    return courses;
  }, response);

  console.log('\n🎯 MARKS DASHBOARD\n' + '='.repeat(50));
  marksData.forEach(course => {
    const totalWeightage = course.marks.reduce((sum, mark) => sum + parseFloat(mark.weightage || 0), 0);
    console.log(`\n📚 [${course.slNo}] ${course.courseCode} - ${course.courseTitle}`);
    console.log(`👨‍🏫 ${course.faculty} | 🕐 ${course.slot} | 📊 Total: ${totalWeightage.toFixed(1)}`);
    
    if (course.marks.length) {
      course.marks.forEach(mark => {
        const percentage = ((parseFloat(mark.scored || 0) / parseFloat(mark.max || 1)) * 100).toFixed(1);
        const status = percentage >= 70 ? '🟢' : percentage >= 50 ? '🟡' : '🔴';
        console.log(`   ${status} ${mark.title}: ${mark.scored}/${mark.max} (${percentage}%) → ${mark.weightage}/${mark.percent}%`);
      });
    } else {
      console.log('   ⏳ No marks posted yet');
    }
  });

  return marksData;
}

// Digital Assignment Function

async function getDigitalAssignmentAjax(page, semesterSubId = 'VL20252601') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  // First request to get all subjects
  const subjectsResponse = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/doDigitalAssignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `authorizedID=${authorizedID}&x=${new Date().toUTCString()}&semesterSubId=${semesterSubId}&_csrf=${csrfToken}`);

  // Parse subjects data
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

  console.log('\n📋 DIGITAL ASSIGNMENTS - ALL SUBJECTS\n' + '='.repeat(60));

  // For each subject, get assignments
  for (const subject of subjectsData) {
    console.log(`\n📚 [${subject.slNo}] ${subject.courseCode} - ${subject.courseTitle}`);
    
    try {
      // Get assignments for this subject
      const assignmentsResponse = await page.evaluate(async (payloadString) => {
        const res = await fetch('/vtop/examinations/processDigitalAssignment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: payloadString
        });
        return await res.text();
      }, `_csrf=${csrfToken}&classId=${subject.classNbr}&authorizedID=${authorizedID}&x=${new Date().toUTCString()}`);

      // Parse assignments - target only the second table (assignments table)
      const assignmentData = await page.evaluate((html) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Find all tables
        const tables = Array.from(tempDiv.querySelectorAll('table.customTable'));
        
        // The assignments table is the second one (index 1)
        const assignmentTable = tables[1];
        if (!assignmentTable) return [];
        
        const rows = Array.from(assignmentTable.querySelectorAll('tbody tr.tableContent'));
        
        return rows.map(row => {
          const cells = row.querySelectorAll('td');
          // Skip if this looks like a header or has wrong number of cells
          if (cells.length < 5) return null;
          
          return {
            slNo: cells[0]?.innerText.trim() || '',
            title: cells[1]?.innerText.trim() || '',
            dueDate: cells[4]?.querySelector('span')?.innerText.trim() || cells[4]?.innerText.trim() || ''
          };
        }).filter(item => item && item.slNo && item.slNo !== 'Sl.No.');
      }, assignmentsResponse);

      if (assignmentData.length > 0) {
        assignmentData.forEach(({ slNo, title, dueDate }) => {
          console.log(`   📝 [${slNo}] ${title} - Due: ${dueDate}`);
        });
      } else {
        console.log('   ⏳ No assignments found');
      }
    } catch (error) {
      console.log('   ❌ Error fetching assignments');
    }
  }

  return { subjects: subjectsData };
}

// Grade View Function
async function getGradeViewAjax(page, semesterSubId = 'VL20242505') {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  // First request - navigate to grade view page
  await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/examGradeView/StudentGradeView', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `verifyMenu=true&authorizedID=${authorizedID}&_csrf=${csrfToken}`);

  // Second request - get grades for specific semester
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/examinations/examGradeView/doStudentGradeView', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `authorizedID=${authorizedID}&_csrf=${csrfToken}&semesterSubId=${semesterSubId}`);

  // Parse grades data
  const gradesData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const rows = Array.from(tempDiv.querySelectorAll('tbody tr'));
    
    const courses = [];
    let gpa = null;
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      
      // Check if this is the GPA row
      if (cells.length === 1 && cells[0].getAttribute('colspan') === '14') {
        const gpaText = cells[0].innerText;
        const gpaMatch = gpaText.match(/GPA\s*:\s*([0-9.]+)/);
        if (gpaMatch) {
          gpa = gpaMatch[1];
        }
        continue;
      }
      
      // Skip header rows and empty rows
      if (cells.length < 11 || cells[0].innerText.trim() === 'Sl.No.') continue;
      
      const course = {
        slNo: cells[0]?.innerText.trim() || '',
        courseCode: cells[1]?.innerText.trim() || '',
        courseTitle: cells[2]?.innerText.trim() || '',
        courseType: cells[3]?.innerText.trim() || '',
        creditsL: cells[4]?.innerText.trim() || '',
        creditsP: cells[5]?.innerText.trim() || '',
        creditsJ: cells[6]?.innerText.trim() || '',
        creditsC: cells[7]?.innerText.trim() || '',
        gradingType: cells[8]?.innerText.trim() || '',
        grandTotal: cells[9]?.innerText.trim() || '',
        grade: cells[10]?.innerText.trim() || ''
      };
      
      // Only add if it has valid data
      if (course.slNo && course.courseCode) {
        courses.push(course);
      }
    }
    
    return { courses, gpa };
  }, response);

  console.log('\n🎓 GRADE REPORT\n' + '='.repeat(50));
  console.log(`📊 Semester GPA: ${gradesData.gpa || 'N/A'}\n`);
  
  gradesData.courses.forEach(course => {
    const totalCredits = parseFloat(course.creditsC || 0);
    const gradeIcon = course.grade === 'S' ? '🌟' : 
                     course.grade === 'A' ? '🟢' : 
                     course.grade === 'B' ? '🟡' : 
                     course.grade === 'C' ? '🟠' : '🔴';
    
    console.log(`${gradeIcon} [${course.slNo}] ${course.courseCode} - ${course.courseTitle}`);
    console.log(`   📚 Type: ${course.courseType} | 🎯 Credits: ${totalCredits} | 📝 Score: ${course.grandTotal} | 🏆 Grade: ${course.grade}`);
  });

  return gradesData;
}
// Leave History Function
async function getLeaveHistoryAjax(page) {
  const { csrfToken, authorizedID } = await getAuthData(page);
  
  // First request - navigate to leave page
  await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/hostels/student/leave/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `verifyMenu=true&authorizedID=${authorizedID}&_csrf=${csrfToken}`);

  // Second request - get leave history
  const response = await page.evaluate(async (payloadString) => {
    const res = await fetch('/vtop/hostels/student/leave/6', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payloadString
    });
    return await res.text();
  }, `_csrf=${csrfToken}&authorizedID=${authorizedID}&history=&form=undefined&control=history&x=${new Date().toUTCString()}`);

  // Parse leave history data
  const leaveData = await page.evaluate((html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const rows = Array.from(tempDiv.querySelectorAll('#LeaveHistoryTable tbody tr'));
    
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      // Skip if not enough cells or hidden row
      if (cells.length < 6) return null;
      
      const leave = {
        visitPlace: cells[1]?.innerText.trim() || '',
        reason: cells[2]?.innerText.trim() || '',
        leaveType: cells[3]?.innerText.trim() || '',
        fromDate: cells[4]?.innerText.trim() || '',
        toDate: cells[5]?.innerText.trim() || '',
        status: cells[6]?.innerText.trim() || ''
      };
      
      // Only return if we have valid data
      return leave.visitPlace ? leave : null;
    }).filter(item => item !== null);
  }, response);

  console.log('\n🏠 LEAVE HISTORY\n' + '='.repeat(50));
  
  if (leaveData.length === 0) {
    console.log('📋 No leave history found');
    return leaveData;
  }

  leaveData.forEach((leave, index) => {
    // Determine status icon
    const statusIcon = leave.status.includes('APPROVED') ? '✅' : 
                      leave.status.includes('CANCELLED') ? '❌' : 
                      leave.status.includes('PENDING') ? '⏳' : '📋';
    
    // Determine leave type icon
    const typeIcon = leave.leaveType.includes('SUMMER') ? '☀️' :
                    leave.leaveType.includes('WINTER') ? '❄️' :
                    leave.leaveType.includes('EMERGENCY') ? '🚨' :
                    leave.leaveType.includes('HOME TOWN') ? '🏠' : '📅';
    
    console.log(`\n${statusIcon} ${typeIcon} [${index + 1}] ${leave.leaveType}`);
    console.log(`   📍 Place: ${leave.visitPlace}`);
    console.log(`   📝 Reason: ${leave.reason}`);
    console.log(`   📅 Duration: ${leave.fromDate} → ${leave.toDate}`);
    console.log(`   📋 Status: ${leave.status}`);
  });

  // Summary statistics
  const totalLeaves = leaveData.length;
  const approvedLeaves = leaveData.filter(l => l.status.includes('APPROVED')).length;
  const cancelledLeaves = leaveData.filter(l => l.status.includes('CANCELLED')).length;
  
  console.log(`\n📊 LEAVE SUMMARY:`);
  console.log(`   Total Applications: ${totalLeaves}`);
  console.log(`   ✅ Approved: ${approvedLeaves}`);
  console.log(`   ❌ Cancelled/Rejected: ${cancelledLeaves}`);
  console.log(`   📈 Success Rate: ${((approvedLeaves / totalLeaves) * 100).toFixed(1)}%`);

  return leaveData;
}
// ===== CAPTCHA SOLVER =====
async function solveCaptcha(page) {
  await page.waitForSelector('img.form-control.img-fluid.bg-light.border-0', { timeout: 10000 });
  
  const captchaDataUrl = await page.evaluate(() => {
    const img = document.querySelector('img.form-control.img-fluid.bg-light.border-0');
    return img ? img.src : null;
  });

  let captchaBuffer;
  const folderPath = path.join(__dirname, 'sample-captchas');
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);

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
async function testVtopLoginWithAjax() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(240000);

  try {
    console.log('🔍 Testing VTOP login with AJAX CGPA fetch...');
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
      // await page.waitForTimeout(1000);

      console.log('⏩ Now clicking submit...');
      await page.click('button:has-text("Submit")');
      
      try {
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        // await page.waitForTimeout(3000);

        loginSuccess = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.card-header.primaryBorderTop span'))
            .some(span => span.textContent && span.textContent.includes('CGPA and CREDIT Status'));
        });

        if (loginSuccess) {
          console.log('🎉 LOGIN SUCCESSFUL!');
          console.log('Current URL:', await page.url());

          console.log('\n🚀 Starting AJAX data extraction...');
          
          await getCGPAAjax(page);
          //  await getLoginHistoryAjax(page);
  // await getAttendanceAjax(page);
  // await getMarkViewAjax(page);
  // await getDigitalAssignmentAjax(page);
  //await getGradeViewAjax(page);
  await getLeaveHistoryAjax(page);
  
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
testVtopLoginWithAjax().then(success => {
  console.log('Final result - Login success:', success);
});