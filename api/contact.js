/**
 * NrgOpt Contact Form — Vercel Serverless Function
 * QQ SMTP → nodemailer
 *
 * Required environment variables:
 *   SMTP_USER    - QQ email address (e.g. 7391117@qq.com)
 *   SMTP_PASS    - QQ SMTP authorization code (NOT the login password)
 *   CONTACT_TO   - Destination email address for receiving inquiries
 */
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigins = new Set(['https://nrgopt.com', 'https://www.nrgopt.com']);
  if (allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { name, email, company, message, website } = req.body || {};
  if (website) return res.status(200).json({ ok: true });
  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: 'Name, email, and message are required.' });
  }
  const clean = {
    name: String(name).trim(),
    email: String(email).trim(),
    company: String(company || '').trim(),
    message: String(message).trim(),
  };
  if (clean.name.length > 100 || clean.email.length > 254 || clean.company.length > 200 || clean.message.length > 5000) {
    return res.status(400).json({ ok: false, error: 'Input is too long.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address.' });
  }

  // Validate environment config
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const contactTo = process.env.CONTACT_TO;

  if (!smtpUser || !smtpPass || !contactTo) {
    console.error('Missing SMTP environment variables');
    return res.status(500).json({
      ok: false,
      error: 'Server configuration error. Please try again later.',
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.qq.com',
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"NrgOpt Contact" <${smtpUser}>`,
      to: contactTo,
      subject: `NrgOpt 咨询来自 ${clean.name.replace(/[\r\n]/g, ' ')}`,
      replyTo: clean.email,
      html: [
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto">',
        '<h2 style="color:#0284c7">NrgOpt — New Inquiry</h2>',
        '<table style="width:100%;border-collapse:collapse">',
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Name</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(clean.name)}</td></tr>`,
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Email</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(clean.email)}</td></tr>`,
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Company</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(clean.company || '-')}</td></tr>`,
        '</table>',
        '<h3 style="margin-top:20px;color:#333">Message</h3>',
        `<p style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap">${esc(clean.message)}</p>`,
        '<hr style="border:none;border-top:1px solid #eee;margin-top:24px">',
        '<p style="color:#999;font-size:12px">Sent from nrgopt.com contact form</p>',
        '</div>',
      ].join(''),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({
      ok: false,
      error: 'Failed to send. Please try again later.',
    });
  }
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
