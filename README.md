# 🍲 Aaj Kya Pakayen? (What to Cook Today?)

A smart, responsive web app crafted for Pakistani households (housewives, working women, hostel students, and bachelors) to decide what to cook using everyday ingredients they already have in their fridge or pantry, minimizing food waste and keeping meals budget-friendly.

---

## 🌟 Key Features

- **Pantry & Fridge Matching**: Enter any available ingredients (potatoes, onions, lentils, eggs, etc.) to get 2–3 authentic Pakistani home-style meal ideas (salan, sabzi, bhujia, daal, pulao).
- **Step-by-Step Recipes**: Quick 4–6 step cooking methods with estimated preparation & cooking times.
- **Stop Food Waste ("Use First" Tip)**: Pinpoints perishable ingredients that spoil fastest (like fresh coriander, tomatoes, or spinach) so you use them before they go bad.
- **Leftover Magic**: Practical suggestions to transform last night's leftovers into fresh meals or breakfast paratha rolls.
- **Bilingual Interface**: Full toggle between **Roman Urdu** (Urdu written in English letters, e.g. *"Aloo Anda Bhujia"*) and **English**. Switching languages live immediately updates both the interface and the meal suggestions.
- **Portion & Budget Controls**: Adjust portion scaling (1 to 20 people) and choose between **Low** (economical) and **Medium** (everyday standard) budget levels.
- **Mobile-First & Accessible**: Designed with high contrast, touch targets (48px+), focus indicators, and reduced-motion support.

---

## 🛠️ Tech Stack

- **Frontend**: Plain HTML5, CSS3, JavaScript in `public/index.html` (zero build tools, zero frameworks, fast load).
- **Backend**: Node.js (18+) with Express and `dotenv`.
- **AI Engine**: Google Gemini API via REST `generateContent` with automated model fallback and retries.

---

## 🚀 Running Locally

### 1. Prerequisites
- [Node.js](https://nodejs.org/) version 18 or higher installed on your computer.

> **Windows PowerShell Note**: If you encounter an execution policy error when running `npm` commands, open PowerShell and run:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

### 2. Setup Project & Dependencies
Open your terminal or PowerShell inside the project directory:
```bash
npm install
```

### 3. Configure Your Environment (`.env`)
1. Copy the `.env.example` file to create your own `.env` file:
   - On Windows PowerShell:
     ```powershell
     Copy-Item .env.example .env
     ```
   - On Linux / macOS:
     ```bash
     cp .env.example .env
     ```
2. Open `.env` in any text editor and paste your Google Gemini API key:
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   PORT=3000
   ```
   *(Get your free API key at [Google AI Studio](https://aistudio.google.com/)).*

### 4. Start the Application
```bash
npm start
```
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🔒 Security Best Practices

- The `.env` file contains your private API credentials and is strictly excluded via `.gitignore`.
- API keys are never exposed to the frontend browser or committed to version control.
- All AI responses in the frontend are rendered exclusively using `textContent` (DOM nodes) to prevent Cross-Site Scripting (XSS).

---

## 🌐 Deploying to Render (Free Public HTTPS Link)

Deploying this app online for free takes only 3 minutes on [Render](https://render.com/):

### Step 1: Push Code to GitHub
1. Initialize git and commit your files (verify that `.env` is NOT tracked):
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Aaj Kya Pakayen"
   ```
2. Create a new repository on [GitHub](https://github.com/new).
3. Link and push your repository:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/aaj-kya-pakayen.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy Web Service on Render
1. Log in to [Render](https://dashboard.render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository.
4. Set the following settings:
   - **Name**: `aaj-kya-pakayen`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
5. Go to the **Environment Variables** section and add:
   - **Key**: `GEMINI_API_KEY`
   - **Value**: *(Your Gemini API key)*
6. Click **Create Web Service**.
7. In ~2 minutes, Render will provide you with a live public HTTPS URL (e.g. `https://aaj-kya-pakayen.onrender.com`).

---

## 🧪 Testing the API Endpoints

- **Health Check**:
  ```bash
  curl http://localhost:3000/api/health
  ```
  Returns:
  ```json
  { "ok": true, "keyLoaded": true }
  ```

- **Meal Suggestion**:
  ```bash
  curl -X POST http://localhost:3000/api/suggest \
    -H "Content-Type: application/json" \
    -d "{\"ingredients\":\"aloo, pyaaz, anday\", \"people\":4, \"budget\":\"low\", \"lang\":\"ur\"}"
  ```
