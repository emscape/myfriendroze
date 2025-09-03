#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting myfriendroze deployment (clean method)...\n');

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

  // Step 3: Deploy to Firebase with clean environment
  console.log('🔥 Deploying to Firebase...');
  
  // Create a clean environment without any Firebase tokens
  const cleanEnv = { ...process.env };
  delete cleanEnv.FIREBASE_TOKEN;
  
  // Check for service account key file
  const serviceAccountPath = path.resolve('firebase-service-account.json');
  
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service account for deployment...');
    cleanEnv.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
    
    execSync('firebase deploy --only hosting', { 
      stdio: 'inherit',
      env: cleanEnv
    });
  } else {
    console.log('❌ Service account key not found!');
    console.log('Please download firebase-service-account.json from:');
    console.log('https://console.firebase.google.com/project/myfriendroze-platform/settings/serviceaccounts/adminsdk');
    process.exit(1);
  }

  console.log('\n🎉 Deployment completed successfully!');
  console.log('Your myfriendroze site is now live! 🌵');

} catch (error) {
  console.error('\n❌ Deployment failed:', error.message);
  process.exit(1);
}
