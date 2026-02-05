# Locoman-server

````md
# 🌍 Loco-Man: AI Travel Guide Chatbot – Backend

This is the **backend** of Loco-Man — a full-stack AI travel chatbot that handles user authentication, voice processing, OpenAI GPT responses, and MongoDB-based storage.

---

## ✨ Features

- 🔐 JWT-based user authentication (Register/Login)
- 💬 Accepts chat input via text or voice
- 🧠 Uses OpenAI GPT for travel-related responses
- 🎙️ Converts voice to text using Whisper API
- 🔊 Responds using OpenAI Text-to-Speech (TTS)
- 🗃️ Stores user chats and credentials in MongoDB
- 🐳 Dockerized backend for deployment ease

---

## 🛠 Tech Stack

| Component     | Tech / Tools                                 |
|---------------|-----------------------------------------------|
| Runtime       | Node.js                                       |
| Framework     | Express.js                                    |
| Database      | MongoDB, Mongoose                             |
| Auth          | JWT, HTTP-only Cookies                        |
| AI APIs       | OpenAI GPT, Whisper, TTS                      |
| Audio Uploads | Multer                                        |
| Deployment    | Docker                                        |

---

## 📁 Folder Structure

```bash
server/               # This backend folder
├── controllers/      # Route controllers
├── routes/           # API route definitions
├── utils/            # Utility functions
├── uploads/          # Runtime audio files
├── .env              # Env variables (not committed)
├── index.js          # Entry point
````

---

## 🔧 Prerequisites

* Node.js (v18+)
* MongoDB (running locally or cloud)
* OpenAI API Key

---

## 🚀 Getting Started

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/77sauravkr/Locoman-server.git
cd Locoman-server
```

---

### 2️⃣ Install Dependencies

```bash
npm install
```

---

### 3️⃣ Configure Environment Variables

Create a `.env` file in the root of `server/`:

```env
OPENAI_API_KEY=your_openai_api_key
JWT_SECRET=your_jwt_secret
CORS_ORIGIN=http://localhost:5182
```

---

### 4️⃣ Start the Backend Server

Make sure MongoDB is running, then run:

```bash
node index.js
```

---

## 🔗 Frontend Repo

The frontend client for this project is here:
👉 [LocoMan Client (React)](https://github.com/77sauravkr/locoMan-client)

---

## 🌐 Live URL (if deployed)

[https://locoman-server.vercel.app](https://locoman-server.vercel.app)

---

## 🪪 License

MIT License © 2024 Sourav Kumar

````

---

### ✅ What’s Fixed:
- Proper folder tree using code block
- Code blocks use triple backticks (` ```bash ` / ` ```env `)
- No random emojis breaking layout
- Live link + frontend link clearly given
- Everything is in **backend context only**

---

Paste this in your `README.md` under `Locoman-server/` and push to GitHub:
```bash
git add README.md
git commit -m "Updated backend README"
git push origin main
````


