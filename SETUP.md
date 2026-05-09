# Scrum Poker — Planning Poker for Agile Teams

Real-time Scrum Poker web app using Firebase.

## Quick Start

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project
2. Enable **Realtime Database**:
   - Go to Build > Realtime Database > Create Database
   - Choose **Start in test mode** (we'll add rules later)
3. Enable **Anonymous Authentication**:
   - Go to Build > Authentication > Sign-in method
   - Enable **Anonymous** sign-in
4. Copy your Firebase config:
   - Go to Project Settings (gear icon) > General > Your apps > Web app
   - Register a new web app if you haven't
   - Copy the `firebaseConfig` object

### 2. Configure the App

Edit `src/firebase.js` and paste your config:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### 3. Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 4. Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to Settings > Pages
3. Set Source to `main` branch, folder `/src`
4. Your app will be live at `https://<username>.github.io/<repo>/`

### 5. Firebase Security Rules

Go to Realtime Database > Rules and paste:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        "users": {
          "$uid": {
            ".validate": "newData.hasChildren(['name', 'online'])",
            "name": {
              ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 20"
            },
            "vote": {
              ".validate": "newData.val() == null || newData.isString()"
            }
          }
        }
      }
    }
  }
}
```

For production, restrict `.write` to authenticated users:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": "auth != null"
      }
    }
  }
}
```

## Features

- Create / Join rooms with a code
- Fibonacci cards (0 - 89) + ? and Coffee
- Real-time sync across all users
- Reveal votes / Reset round
- Auto-remove disconnected users
- Dark mode
- Mobile responsive
- Share room link

## Project Structure

```
scrum-poker/
├── src/
│   ├── index.html      # Main HTML
│   ├── style.css       # Styles + dark mode + responsive
│   ├── firebase.js     # Firebase config & exports
│   └── app.js          # Application logic
├── package.json
├── .gitignore
└── SETUP.md            # This file
```

## Tech Stack

- Vanilla HTML/CSS/JavaScript (no framework)
- Firebase Realtime Database
- Firebase Anonymous Auth
- ES Modules
