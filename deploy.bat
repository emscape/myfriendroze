@echo off
echo 🚀 Starting myfriendroze deployment...
echo.

REM Step 1: Build the Astro project
echo 📦 Building Astro project...
cd astro
call npm run build
if %errorlevel% neq 0 (
    echo ❌ Build failed
    exit /b 1
)
cd ..
echo ✅ Astro build completed
echo.

REM Step 2: Copy files to root dist directory
echo 📁 Copying files to dist directory...
if not exist "dist" mkdir dist
xcopy "astro\dist\*" "dist\" /E /Y /Q
echo ✅ Files copied successfully
echo.

REM Step 3: Deploy to Firebase
echo 🔥 Deploying to Firebase...

if defined FIREBASE_TOKEN (
    echo Using CI token for deployment...
    firebase deploy --only hosting --token "%FIREBASE_TOKEN%"
) else (
    echo No CI token found. Attempting regular deployment...
    echo If authentication fails, run: firebase login:ci
    echo Then set FIREBASE_TOKEN environment variable
    echo.
    firebase deploy --only hosting
    if %errorlevel% neq 0 (
        echo.
        echo ❌ Authentication failed. Please run:
        echo 1. firebase login:ci
        echo 2. set FIREBASE_TOKEN=your_token_here
        echo 3. Run this script again
        exit /b 1
    )
)

echo.
echo 🎉 Deployment completed successfully!
echo Your myfriendroze site is now live! 🌵
pause
