# OTP Email Verification Backend

A Node.js/Express backend that sends OTP codes via Gmail and verifies them using Supabase for storage.

## Features

- Send 6-digit OTP via Gmail (Nodemailer)
- OTP verification with expiry (5 minutes)
- Rate limiting: max 3 attempts per OTP, then auto-delete
- Supabase REST API for persistent storage (no SDK needed)
- Old unverified OTPs auto-deleted when a new one is requested

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Email:** Nodemailer (Gmail SMTP)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Gmail App Password

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```env
GMAIL_USER=your_gmail@gmail.com
GMAIL_APP_PASSWORD=your_16_char_app_password
PORT=5000
OTP_EXPIRY_MINUTES=5
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Gmail App Password

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification**
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Select **Mail** > **Other (Custom name)** > type "OTP Backend"
5. Copy the 16-character password

### 4. Supabase Table

Run this SQL in Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. Start the server

```bash
npm start
```

Server runs on `http://localhost:5000`

## API Endpoints

### Send OTP

```
POST /api/send-otp
```

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

### Verify OTP

```
POST /api/verify-otp
```

**Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

**Response (failed - wrong OTP):**
```json
{
  "success": false,
  "message": "Invalid OTP. 2 attempts remaining."
}
```

**Response (max attempts exceeded):**
```json
{
  "success": false,
  "message": "Too many failed attempts. Request a new OTP."
}
```

### Health Check

```
GET /api/health
```

```json
{
  "status": "ok"
}
```

## Behavior

| Scenario | Result |
|---|---|
| New OTP requested | Deletes old unverified OTPs for that email |
| Wrong OTP entered | Increments `attempts` counter |
| 3 failed attempts | OTP deleted, must request a new one |
| OTP expires (5 min) | OTP deleted on next verify attempt |
| OTP verified | Marked as `verified: true` |
