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

  // Clear any existing Firebase token to avoid conflicts
  delete process.env.FIREBASE_TOKEN;

  // Ensure we're logged out to avoid cached credential conflicts
  try {
    execSync('firebase logout', { stdio: 'pipe' });
  } catch (error) {
    // Ignore logout errors (user might already be logged out)
  }

  // Check for service account key file
  const serviceAccountPath = 'firebase-service-account.json';

  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using service account for deployment...');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(serviceAccountPath);
    execSync('firebase deploy --only hosting', { stdio: 'inherit' });
  } else {
    console.log('No service account found. Attempting regular deployment...');
    console.log('If authentication fails, please:');
    console.log('1. Download service account key from Firebase Console');
    console.log('2. Save as firebase-service-account.json in project root');
    console.log('3. Run this script again\n');

    try {
      execSync('firebase deploy --only hosting', { stdio: 'inherit' });
    } catch (error) {
      console.log('\n❌ Authentication failed. Please set up service account:');
      console.log('1. Go to Firebase Console > Project Settings > Service Accounts');
      console.log('2. Click "Generate new private key"');
      console.log('3. Save as firebase-service-account.json');
      console.log('4. Run this script again');
      process.exit(1);
    }
  }

  console.log('\n🎉 Deployment completed successfully!');
  console.log('Your myfriendroze site is now live! 🌵');

} catch (error) {
  console.error('\n❌ Deployment failed:', error.message);
  process.exit(1);
}
