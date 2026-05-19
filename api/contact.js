/**
 * NrgOpt Contact Form — Vercel Serverless Function
 * QQ SMTP → nodemailer
 */
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { name, email, company, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: 'Name, email, and message are required.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.qq.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER || '7391117@qq.com',
        pass: process.env.SMTP_PASS || 'eaeudffrtpinbhgd',
      },
    });

    const contactTo = process.env.CONTACT_TO || '7391117@qq.com';

    await transporter.sendMail({
      from: `"NrgOpt Contact" <7391117@qq.com>`,
      to: contactTo,
      subject: `NrgOpt 咨询来自 ${name}`,
      html: [
        '<div style="font-family:sans-serif;max-width:600px;margin:0 auto">',
        '<h2 style="color:#0284c7">NrgOpt — New Inquiry</h2>',
        '<table style="width:100%;border-collapse:collapse">',
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Name</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(name)}</td></tr>`,
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Email</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(email)}</td></tr>`,
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Company</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(company || '-')}</td></tr>`,
        '</table>',
        '<h3 style="margin-top:20px;color:#333">Message</h3>',
        `<p style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap">${esc(message)}</p>`,
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
      error: 'Failed to send. Please email us directly at 7391117@qq.com',
    });
  }
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
