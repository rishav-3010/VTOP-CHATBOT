require('dotenv').config();
const { chromium } = require('playwright');
const { solveUsingViboot } = require('./captcha/captchaSolver');
const path = require('path');
const fs = require('fs');


const username = process.env.VTOP_USERNAME;
const password = process.env.VTOP_PASSWORD;




// ===== SCRAPING FUNCTIONS =====
//Kindly refer to vtop function levels fort the navigation of function


//shubhmoy u will make timetable[[2] Text: "Time Table" | data-url: "academics/common/StudentTimeTable"]


//Ayush: put how many class to attend/leave for 75% attendance[[1] Text: "Class Attendance" | data-url: "academics/common/StudentAttendance"
//Ayush:Also make Mark View function scrapeMarkView(page) navigation link: [57] Text: "Marks" | data-url: "examinations/StudentMarkView"            




async function scrapeAttendance(page) {
  console.log('🎯 Navigating to Attendance page...');
 
  // Navigate to attendance page by finding the link with text containing 'Class Attendance'
  const attendanceClicked = await page.evaluate(() => {
    const links = Array.from(document.getElementsByTagName('a')).filter(
      e => e.dataset && e.dataset.url && (
        e.innerText.trim().includes('Class Attendance')
      )
    );
    if (links.length > 0) {
      links[0].click();
      return true;
    }
    return false;
  });


  if (!attendanceClicked) {
    console.log('⚠️ Class Attendance link not found!');
    return;
  }


  console.log('✅ Navigation to Class Attendance initiated.');


  // Wait for the page to load completely and the form to be available
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form#viewStudentAttendance', { timeout: 15000 });
  await page.waitForSelector('select#semesterSubId', { timeout: 10000 });


  console.log('✅ Attendance page loaded, selecting semester...');


  // Select "Fall Semester 2025-26" by its value - same approach as DA Upload
  await page.selectOption('select#semesterSubId', 'VL20252601');
  console.log('✅ Fall Semester 2025-26 selected on Attendance page.');


  // Wait for the attendance table to load after semester selection
  await page.waitForSelector('#AttendanceDetailDataTable tbody tr', { timeout: 15000 });


  // Extract attendance data
  const attendanceData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#AttendanceDetailDataTable tbody tr'));
   
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
     
      // Extract attendance percentage text and remove any HTML
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
        attendancePercentage: attendancePercentage,
        debarStatus: cells[8]?.innerText.trim() || ''
      };
    }).filter(item => item.slNo); // Filter out empty rows
  });


  // Print attendance data nicely
  console.log('\n📊 ATTENDANCE SUMMARY:');
  console.log('=' .repeat(80));
 
  attendanceData.forEach(({ slNo, courseDetail, attendedClasses, totalClasses, attendancePercentage, debarStatus }) => {
    console.log(`\n[${slNo}] ${courseDetail}`);
    console.log(`    Attended: ${attendedClasses}/${totalClasses} classes`);
    console.log(`    Percentage: ${attendancePercentage}`);
    console.log(`    Debar Status: ${debarStatus}`);
  });


  console.log('\n' + '='.repeat(80));


  return attendanceData;
}


async function scrapeDAUpload(page) {
  console.log('\n🔗 Navigating to DA Upload...');
  const daUploadClicked = await page.evaluate(() => {
    const links = Array.from(document.getElementsByTagName('a')).filter(
      e => e.dataset && e.dataset.url && (
        e.innerText.trim().includes('DA Upload') ||
        e.innerText.trim().includes('Digital Assignment Upload')
      )
    );
    if (links.length > 0) {
      links[0].click();
      return true;
    }
    return false;
  });


  if (!daUploadClicked) return console.log('❌ Could not find DA Upload link.');
 
  console.log('✅ Navigation to DA Upload initiated.');
  await page.waitForTimeout(2000);


  try {
    await page.waitForSelector('select#semesterSubId', { timeout: 10000 });
    await page.selectOption('select#semesterSubId', 'VL20252601');
    console.log('✅ Fall Semester 2025-26 selected on DA Upload page.');
    await page.waitForTimeout(2000);
  } catch (error) {
    console.log('⚠️ Could not find semester dropdown on DA Upload page...');
  }


  await page.waitForSelector('tbody', { timeout: 10000 }).catch(()=>{});


  const daAssignments = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr.tableContent'));
    return rows.map(row => {
      const cells = row.querySelectorAll('td');
      return {
        slNo: cells[0]?.innerText.trim() || '',
        classNbr: cells[1]?.innerText.trim() || '',
        courseCode: cells[2]?.innerText.trim() || '',
        courseTitle: cells[3]?.innerText.trim() || '',
        courseType: cells[4]?.innerText.trim() || '',
        facultyName: cells[5]?.innerText.trim() || '',
      };
    });
  });


  console.log('📋 Digital Assignment Upload Data:');
  if (daAssignments.length > 0) {
    daAssignments.forEach(({ slNo, classNbr, courseCode, courseTitle, courseType, facultyName }) => {
      console.log(`\n[${slNo}] Course: ${courseCode} - ${courseTitle}`);
      console.log(`    Class Number: ${classNbr}`);
      console.log(`    Course Type: ${courseType}`);
      console.log(`    Faculty: ${facultyName}`);
    });
  } else {
    console.log('No DA upload data found.');
  }
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






//no need to touch this
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
  const browser = await chromium.launch({ headless: false });
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
         
          // Extract CGPA from dashboard
          let cgpa = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('li.list-group-item.d-flex.justify-content-between.align-items-start.p-0.m-0'));
            for (const item of items) {
              if (
                item.textContent.includes('Current CGPA') ||
                item.querySelector('.card-title.fontcolor1')?.textContent.includes('Current CGPA')
              ) {
                const spans = item.querySelectorAll('span');
                if (spans.length > 1) {
                  return (spans[2] || spans[1]).textContent.trim();
                }
              }
            }
            return null;
          });


          if (cgpa) {
            console.log('🌟 Your CGPA is:', cgpa);
          } else {
            console.log('⚠️ Could not find CGPA on dashboard!');
          }






          // console.log('\n📋 All VTOP navigation links with data-url:');
          // allLinksData.forEach((l, i) => {
          //   console.log(`[${i}] Text: "${l.text}" | data-url: "${l.dataUrl}" | href: ${l.href}`);
          // });


          // ===== SCRAPE ALL SECTIONS =====
          console.log('\n🚀 Starting comprehensive data extraction...');
         
          // Run all scraping functions


          await scrapeDAUpload(page);
          // await scrapeAttendance(page);
          // await scrapeTimeTable(page);
         


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

