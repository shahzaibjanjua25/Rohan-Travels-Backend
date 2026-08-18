// backend/src/services/emailService.js
const { sendEmail } = require('../config/email');
const config = require('../config/env');

/**
 * Send OTP via email
 * Uses the existing email configuration with console fallback
 */
const sendOTPEmail = async (toEmail, otpCode, userName = 'User', type = 'verification') => {
  const subject = type === 'verification' 
    ? 'Verify Your Email - Rohan Travels & Tours' 
    : 'Password Reset OTP - Rohan Travels & Tours';

  const otpType = type === 'verification' ? 'Account Verification' : 'Password Reset';
  const expiryTime = '10 minutes';

  const textContent = `
ROHAN TRAVELS & TOURS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Hello ${userName},

Thank you for choosing Rohan Travels & Tours.
Please use the verification code below to complete your
${otpType} process.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Your Verification Code: ${otpCode}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This code will expire in ${expiryTime}.

🔒 Security Tip:
Never share this code with anyone. Our team will never ask
for your verification code.

❓ Didn't request this?
If you didn't request this verification, please ignore this email.
Your account is secure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Need help? Contact us at support@rohantravels.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

© ${new Date().getFullYear()} Rohan Travels & Tours. All rights reserved.
This is an automated message. Please do not reply to this email.
  `;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f4f6f9;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #0a2463 0%, #1a4a8a 50%, #2a6aaa 100%);
            padding: 30px 20px;
            text-align: center;
        }
        .header h1 {
            color: #ffffff;
            font-size: 24px;
            font-weight: 700;
            margin: 0;
            letter-spacing: 0.5px;
        }
        .header p {
            color: rgba(255, 255, 255, 0.85);
            font-size: 14px;
            margin: 8px 0 0 0;
        }
        .content {
            padding: 35px 30px;
        }
        .greeting {
            font-size: 18px;
            font-weight: 600;
            color: #1a2332;
            margin: 0 0 8px 0;
        }
        .message {
            color: #4a5568;
            font-size: 15px;
            line-height: 1.6;
            margin: 10px 0 20px 0;
        }
        .otp-box {
            background-color: #e8edf7;
            border-radius: 10px;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border: 2px dashed #0a2463;
        }
        .otp-code {
            font-size: 36px;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            color: #0a2463;
            letter-spacing: 8px;
            padding: 10px 0;
        }
        .otp-label {
            font-size: 12px;
            color: #6b7a8f;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
        }
        .divider {
            border: none;
            border-top: 2px solid #e8edf7;
            margin: 25px 0;
        }
        .info-text {
            font-size: 13px;
            color: #6b7a8f;
            line-height: 1.6;
            margin: 5px 0;
        }
        .info-text strong {
            color: #1a2332;
        }
        .footer {
            background-color: #f8f9fc;
            padding: 20px 30px;
            text-align: center;
            border-top: 1px solid #e8edf7;
        }
        .footer-text {
            font-size: 12px;
            color: #8a94a6;
            margin: 0;
        }
        .footer-text a {
            color: #0a2463;
            text-decoration: none;
        }
        .footer-text a:hover {
            text-decoration: underline;
        }
        @media (max-width: 480px) {
            .content {
                padding: 20px;
            }
            .otp-code {
                font-size: 28px;
                letter-spacing: 6px;
            }
            .header h1 {
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✈️ Rohan Travels & Tours</h1>
            <p>Your Trusted Travel Partner</p>
        </div>
        <div class="content">
            <p class="greeting">Hello ${userName},</p>
            <p class="message">
                Thank you for choosing <strong>Rohan Travels & Tours</strong>.
                Please use the verification code below to complete your
                <strong>${otpType}</strong> process.
            </p>
            <div class="otp-box">
                <div class="otp-label">Your Verification Code</div>
                <div class="otp-code">${otpCode}</div>
                <div style="font-size: 12px; color: #6b7a8f; margin-top: 5px;">
                    This code will expire in <strong>${expiryTime}</strong>
                </div>
            </div>
            <hr class="divider">
            <p class="info-text">
                <strong>🔒 Security Tip:</strong>
                Never share this code with anyone. Our team will never ask for your verification code.
            </p>
            <p class="info-text">
                <strong>❓ Didn't request this?</strong>
                If you didn't request this verification, please ignore this email.
                Your account is secure.
            </p>
            <hr class="divider">
            <p class="info-text" style="font-size: 12px; color: #8a94a6;">
                Need help? Contact our support team at
                <strong>support@rohantravels.com</strong>
            </p>
        </div>
        <div class="footer">
            <p class="footer-text">
                &copy; ${new Date().getFullYear()} Rohan Travels & Tours. All rights reserved.
            </p>
            <p class="footer-text" style="margin-top: 4px;">
                This is an automated message. Please do not reply to this email.
            </p>
        </div>
    </div>
</body>
</html>
  `;

  // Use the existing sendEmail function
  const result = await sendEmail({
    to: toEmail,
    subject,
    text: textContent,
    html: htmlContent,
  });

  return result;
};

module.exports = { sendOTPEmail };