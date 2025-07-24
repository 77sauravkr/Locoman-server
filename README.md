# Locoman-server


Aree sahi pakde bhai 😎
Tu clearly bol raha hai: **ek hi `README.md` file chahiye** jo **full project ke liye ready to use ho** — bas paste karo aur GitHub pe dikhe.

---

## ✅ Final `README.md` (One file — Ready to paste)

```md
# 🌍 Loco-Man: AI Travel Guide Chatbot

Loco-Man is a full-stack AI-powered travel chatbot web app that allows users to ask travel-related questions via **text or voice**. It responds with AI-generated answers and can even speak the response using **text-to-speech**.

---

## ✨ Features

- 🔐 User authentication (Register, Login, Logout)
- 💬 Chat with AI using text or voice
- 🧠 AI-powered answers using OpenAI GPT
- 🎙️ Speech-to-text using OpenAI Whisper
- 🔊 Text-to-speech using OpenAI TTS
- 🗃️ Persistent chat history per user
- 🎨 Modern frontend with React, Vite, Tailwind CSS
- 🧱 Backend with Node.js, Express, and MongoDB
- 🐳 Dockerized backend for easy deployment

---

## 🛠 Tech Stack

| Layer        | Tools / Frameworks                                |
|--------------|---------------------------------------------------|
| **Frontend** | React, Vite, Tailwind CSS                         |
| **Backend**  | Node.js, Express, MongoDB, Mongoose, Multer       |
| **AI APIs**  | OpenAI GPT, Whisper (Speech-to-text), TTS         |
| **Auth**     | JWT, HTTP-only cookies                            |
| **Deployment** | Docker                                           |

---

## 🚀 Getting Started

### 🔧 Prerequisites

- Node.js (v18+)
- MongoDB
- OpenAI API Key

---

## 📁 Folder Structure

```

loco-man/
├── client/       # React frontend (Vite)
├── server/       # Node.js + Express backend
├── uploads/      # Audio files (runtime)

````

---

## 🧪 Setup Instructions

### 1️⃣ Clone the repository

```bash
git clone https://github.com/77sauravkr/loco-man.git
cd loco-man
````

---

### 2️⃣ Backend Setup

```bash
cd server
npm install
```

🔐 Create a `.env` file with:

```env
OPENAI_API_KEY=your_openai_api_key
JWT_SECRET=your_jwt_secret
CORS_ORIGIN=http://localhost:5182
```

```bash
# Start MongoDB locally
node index.js
```

---

### 3️⃣ Frontend Setup

```bash
cd ../client
npm install
```

🛠 Create a `.env` file with:

```env
VITE_API_HOST=localhost
VITE_API_PORT=3101
VITE_OPENAI_API_KEY=your_openai_api_key
```

```bash
npm run dev
```

---

## 🌐 Usage

* Visit: [http://localhost:5182](http://localhost:5182)
* Register/Login
* Type or speak your travel query
* Listen to the response

---

## 🪪 License

MIT License © 2024 Sourav Kumar

```

---

### 📌 Final Notes:
- Ye single file dono repos (mono-repo structure) ke liye best hai.
- Tu isse paste kar de `README.md` file me at root.
- GitHub pe turant perfect dikhega.

Agar tu multiple environment me deploy karega (Render, Vercel, etc.) to `deployment` section bhi add karwa dena — bol de, bana dunga.

Ready to go! ✅
```
