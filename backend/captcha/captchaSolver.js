// captcha/captchaSolver.js
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// Load the bitmaps data (you'll need to create this file)
const bitmaps = require('./bitmaps.js');

class VibootCaptchaSolver {
  constructor() {
    this.HEIGHT = 40;
    this.WIDTH = 200;
    this.label_txt = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  }

  // Port of the saturation function from the extension
  saturation(imageData) {
    const d = imageData.data;
    const saturate = new Array(d.length / 4);
    
    for (let i = 0; i < d.length; i += 4) {
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      saturate[i / 4] = Math.round(((max - min) * 255) / max);
    }
    
    const img = new Array(40);
    for (let i = 0; i < 40; i += 1) {
      img[i] = new Array(200);
      for (let j = 0; j < 200; j += 1) {
        img[i][j] = saturate[i * 200 + j];
      }
    }
    
    const bls = new Array(6);
    for (let i = 0; i < 6; i += 1) {
      const x1 = (i + 1) * 25 + 2;
      const y1 = 7 + 5 * (i % 2) + 1;
      const x2 = (i + 2) * 25 + 1;
      const y2 = 35 - 5 * ((i + 1) % 2);
      bls[i] = img.slice(y1, y2).map((row) => row.slice(x1, x2));
    }
    
    return bls;
  }

  // Port of the pre_img function
  pre_img(img) {
    let avg = 0;
    img.forEach((row) => row.forEach((pixel) => (avg += pixel)));
    avg /= 24 * 22;
    
    const bits = new Array(img.length);
    for (let i = 0; i < img.length; i += 1) {
      bits[i] = new Array(img[0].length);
      for (let j = 0; j < img[0].length; j += 1) {
        bits[i][j] = img[i][j] > avg ? 1 : 0;
      }
    }
    return bits;
  }

  // Port of the flatten function
  flatten(arr) {
    const bits = new Array(arr.length * arr[0].length);
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = 0; j < arr[0].length; j += 1) {
        bits[i * arr[0].length + j] = arr[i][j];
      }
    }
    return bits;
  }

  // Port of matrix multiplication
  mat_mul(a, b) {
    const x = a.length;
    const z = a[0].length;
    const y = b[0].length;
    const productRow = Array.apply(null, new Array(y)).map(Number.prototype.valueOf, 0);
    const product = new Array(x);
    
    for (let p = 0; p < x; p++) {
      product[p] = productRow.slice();
    }
    
    for (let i = 0; i < x; i++) {
      for (let j = 0; j < y; j++) {
        for (let k = 0; k < z; k++) {
          product[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    return product;
  }

  // Port of matrix addition
  mat_add(a, b) {
    const x = a.length;
    const c = new Array(x);
    for (let i = 0; i < x; i++) {
      c[i] = a[i] + b[i];
    }
    return c;
  }

  // Port of softmax function
  max_soft(a) {
    const n = [...a];
    let s = 0;
    n.forEach((f) => {
      s += Math.exp(f);
    });
    for (let i = 0; i < a.length; i++) {
      n[i] = Math.exp(a[i]) / s;
    }
    return n;
  }

  // Main solving function - adapted from the extension
  async solve(imageBuffer) {
    try {
      // Load image using canvas
      const img = await loadImage(imageBuffer);
      const canvas = createCanvas(200, 40);
      const ctx = canvas.getContext('2d');
      
      // Draw image and get image data
      ctx.drawImage(img, 0, 0, 200, 40);
      const imageData = ctx.getImageData(0, 0, 200, 40);
      
      // Process using the extension's algorithm
      let bls = this.saturation(imageData);
      let result = "";
      
      const weights = bitmaps.weights;
      const biases = bitmaps.biases;
      
      for (let i = 0; i < 6; i += 1) {
        bls[i] = this.pre_img(bls[i]);
        bls[i] = [this.flatten(bls[i])];
        bls[i] = this.mat_mul(bls[i], weights);
        bls[i] = this.mat_add(...bls[i], biases);
        bls[i] = this.max_soft(bls[i]);
        bls[i] = bls[i].indexOf(Math.max(...bls[i]));
        result += this.label_txt[bls[i]];
      }
      
      return result;
    } catch (error) {
      console.error('Error solving CAPTCHA:', error);
      throw error;
    }
  }

  // Alternative bitmap matching approach (the simpler one from extension)
  async solveBitmap(imageBuffer) {
    try {
      const img = await loadImage(imageBuffer);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Convert to grayscale array
      let arr = [];
      let newArr = [];
      for (let i = 0; i < imageData.data.length; i += 4) {
        let gval = imageData.data[i] * 0.299 + 
                   imageData.data[i + 1] * 0.587 + 
                   imageData.data[i + 2] * 0.114;
        arr.push(gval);
      }
      
      while (arr.length) newArr.push(arr.splice(0, 180));
      
      return this.captcha_parse(newArr);
    } catch (error) {
      console.error('Error in bitmap solving:', error);
      throw error;
    }
  }

  // Port of the captcha_parse function
  captcha_parse(imgarr) {
    let captcha = "";
    
    // Clean up noise
    for (let x = 1; x < 40; x++) {
      for (let y = 1; y < 200; y++) {
        const condition1 = imgarr[x][y - 1] === 255 && 
                          imgarr[x][y] === 0 && 
                          imgarr[x][y + 1] === 255;
        const condition2 = imgarr[x - 1][y] === 255 && 
                          imgarr[x][y] === 0 && 
                          imgarr[x + 1][y] === 255;
        const condition3 = imgarr[x][y] !== 255 && imgarr[x][y] !== 0;
        
        if (condition1 || condition2 || condition3) {
          imgarr[x][y] = 255;
        }
      }
    }
    
    // Match characters
    for (let j = 30; j < 181; j += 30) {
      let matches = [];
      const chars = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
      
      for (let i = 0; i < chars.length; i++) {
        let match = 0;
        let black = 0;
        const ch = chars.charAt(i);
        const mask = bitmaps[ch];
        
        if (!mask) continue;
        
        for (let x = 0; x < 32; x++) {
          for (let y = 0; y < 30; y++) {
            let y1 = y + j - 30;
            let x1 = x + 12;
            if (imgarr[x1] && imgarr[x1][y1] == mask[x][y] && mask[x][y] == 0) {
              match += 1;
            }
            if (mask[x][y] == 0) {
              black += 1;
            }
          }
        }
        const perc = match / black;
        matches.push([perc, ch]);
      }
      
      captcha += matches.reduce(
        function (a, b) {
          return a[0] > b[0] ? a : b;
        },
        [0, 0]
      )[1];
    }
    
    return captcha;
  }
}

// Export the main function
async function solveUsingViboot(imageBuffer) {
  const solver = new VibootCaptchaSolver();
  
  try {
    // Try the neural network approach first
    const result = await solver.solve(imageBuffer);
    console.log('ViBoOT Neural Network result:', result);
    return result;
  } catch (error) {
    console.log('Neural network approach failed, trying bitmap matching...');
    try {
      // Fallback to bitmap matching
      const result = await solver.solveBitmap(imageBuffer);
      console.log('ViBoOT Bitmap matching result:', result);
      return result;
    } catch (bitmapError) {
      console.error('Both approaches failed:', error, bitmapError);
      throw new Error('Both ViBoOT solving methods failed');
    }
  }
}

module.exports = { solveUsingViboot, VibootCaptchaSolver };