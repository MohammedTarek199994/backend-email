require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
const MAX_ATTEMPTS = 3;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function supabaseQuery(method, table, { body, params } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.hint || res.statusText);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

app.post("/api/send-otp", async (req, res) => {
  const { email } = req.body;
  console.log("in backend", email);

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email format" });
  }

  const otp = generateOTP();
  const expiresAt = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString();

  try {
    await supabaseQuery("DELETE", "otp_codes", {
      params: { email: `eq.${email}`, verified: "eq.false" },
    });
    await supabaseQuery("POST", "otp_codes", {
      body: { email, code: otp, expires_at: expiresAt },
    });
  } catch (error) {
    console.error("Error storing OTP:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to store OTP" });
  }

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: "Your OTP Code",
      html: `
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
          <h2>Your OTP Code</h2>
          <p>Use the following code to verify your email:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0; color: #333;">
            ${otp}
          </div>
          <p style="color: #666;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
          <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
      `,
    });

    console.log(`OTP sent to ${email}: ${otp}`);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    await supabaseQuery("DELETE", "otp_codes", {
      params: { email: `eq.${email}`, code: `eq.${otp}` },
    });
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required" });
  }

  try {
    const records = await supabaseQuery("GET", "otp_codes", {
      params: {
        email: `eq.${email}`,
        verified: "eq.false",
        order: "created_at.desc",
        limit: "1",
      },
    });

    if (!records || records.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    const record = records[0];

    if (new Date(record.expires_at) < new Date()) {
      await supabaseQuery("DELETE", "otp_codes", {
        params: { id: `eq.${record.id}` },
      });
      return res
        .status(400)
        .json({
          success: false,
          message: "OTP has expired. Request a new one.",
        });
    }

    if (record.code !== otp.toString()) {
      const newAttempts = (record.attempts || 0) + 1;

      if (newAttempts >= MAX_ATTEMPTS) {
        await supabaseQuery("DELETE", "otp_codes", {
          params: { id: `eq.${record.id}` },
        });
        return res
          .status(400)
          .json({
            success: false,
            message: "Too many failed attempts. Request a new OTP.",
          });
      }

      await supabaseQuery("PATCH", "otp_codes", {
        body: { attempts: newAttempts },
        params: { id: `eq.${record.id}` },
      });
      return res
        .status(400)
        .json({
          success: false,
          message: `Invalid OTP. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`,
        });
    }

    await supabaseQuery("PATCH", "otp_codes", {
      body: { verified: true },
      params: { id: `eq.${record.id}` },
    });

    console.log(`OTP verified for ${email}`);
    res.json({ success: true, message: "Email verified successfully" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ success: false, message: "Failed to verify OTP" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

module.exports = app;
