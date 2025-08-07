# 🚀 myfriendroze Automated Deployment

## Quick Setup (One-time only)

1. **Generate Firebase CI Token:**
   ```bash
   firebase login:ci
   ```
   This will output a token like: `1//0GWIOIkjhsdf...`

2. **Set Environment Variable:**
   
   **Windows (Command Prompt):**
   ```cmd
   set FIREBASE_TOKEN=your_token_here
   ```
   
   **Windows (PowerShell):**
   ```powershell
   $env:FIREBASE_TOKEN="your_token_here"
   ```
   
   **Mac/Linux:**
   ```bash
   export FIREBASE_TOKEN=your_token_here
   ```

3. **Make it Permanent (Optional):**
   - **Windows:** Add to System Environment Variables
   - **Mac/Linux:** Add to `~/.bashrc` or `~/.zshrc`

## Deployment Options

### Option 1: Use the Deployment Scripts

**Windows:**
```cmd
deploy.bat
```

**Mac/Linux/Node.js:**
```bash
node deploy.js
```

### Option 2: Use npm script (from astro directory)
```bash
cd astro
npm run deploy
```

### Option 3: Manual Commands
```bash
# Build
cd astro && npm run build && cd ..

# Copy files
cp -r astro/dist/* dist/

# Deploy
firebase deploy --only hosting --token "$FIREBASE_TOKEN"
```

## What the Automated Deployment Does

1. ✅ **Builds** the Astro project
2. ✅ **Copies** built files to the correct directory
3. ✅ **Deploys** to Firebase hosting automatically
4. ✅ **Handles** authentication with CI token
5. ✅ **Provides** clear success/error messages

## Troubleshooting

**If you get authentication errors:**
1. Run `firebase login:ci` to get a new token
2. Update your `FIREBASE_TOKEN` environment variable
3. Try deployment again

**If the build fails:**
- Check that you're in the correct directory
- Make sure all dependencies are installed: `cd astro && npm install`

**If files aren't copying:**
- Make sure the `dist` directory exists in the root
- Check file permissions

## Benefits of This Setup

- 🔄 **No manual reauthentication** needed
- ⚡ **One-command deployment**
- 🛡️ **Secure** token-based authentication
- 📝 **Clear error messages** and guidance
- 🎯 **Works on all platforms** (Windows, Mac, Linux)

## Security Note

Keep your Firebase CI token secure and don't commit it to version control. Use environment variables or secure CI/CD systems to store it.
