#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file (check both root and astro directory)
const envPaths = ['.env', 'astro/.env'];
envPaths.forEach(envPath => {
  if (fs.existsSync(envPath)) {
    console.log(`📄 Loading environment variables from ${envPath}`);
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.trim().replace(/['"]/g, ''); // Remove quotes
      }
    });
  }
});

console.log('🚀 Starting myfriendroze deployment...\n');

try {
  // Step 1: Build the Astro project
  console.log('📦 Building Astro project...');
  execSync('cd astro && npm run build', { stdio: 'inherit' });
  console.log('✅ Astro build completed\n');

  // Step 2: Copy files to root dist directory
  console.log('📁 Copying files to dist directory...');
  
  // Ensure dist directory exists
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
  }

  // Copy all files from astro/dist to root dist
  execSync('cp -r astro/dist/* dist/', { stdio: 'inherit' });
  console.log('✅ Files copied successfully\n');

  // Step 3: Deploy to Firebase
  console.log('🔥 Deploying to Firebase...');
  
  // Check if FIREBASE_TOKEN environment variable exists
  const firebaseToken = process.env.FIREBASE_TOKEN;
  
  if (firebaseToken) {
    console.log('Using CI token for deployment...');
    execSync(`firebase deploy --only hosting --token "${firebaseToken}"`, { stdio: 'inherit' });
  } else {
    console.log('No CI token found. Attempting regular deployment...');
    console.log('If authentication fails, run: firebase login:ci');
    console.log('Then set FIREBASE_TOKEN environment variable\n');
    
    try {
      execSync('firebase deploy --only hosting', { stdio: 'inherit' });
    } catch (error) {
      console.log('\n❌ Authentication failed. Please run:');
      console.log('1. firebase login:ci');
      console.log('2. Set FIREBASE_TOKEN environment variable');
      console.log('3. Run this script again');
      process.exit(1);
    }
  }

  console.log('\n🎉 Deployment completed successfully!');
  console.log('Your myfriendroze site is now live! 🌵');

} catch (error) {
  console.error('\n❌ Deployment failed:', error.message);
  process.exit(1);
}
