# Email-Based Authentication

## Overview

Cartly now supports email-based authentication with a "Forgot Family Code" recovery feature. Users sign up with their email address and share a family code to collaborate with others.

## Features

✨ **Email-Based Sign Up**
- Users create accounts with: Name, Email, Nickname, Family Name, and Family Code
- Email address uniquely identifies each user
- All data encrypted and stored securely

🔐 **Email-Based Login**
- Sign in with Email and Family Code
- No passwords needed - family code acts as shared secret
- Simple, family-friendly authentication

💌 **Family Code Recovery**
- Forgot your family code? Click "Forgot Family Code?" on login page
- Enter your email address
- Receive your family code via email
- Use it to sign back in

👥 **Family Collaboration**
- Share your family code with family members
- Multiple people can access the same family's shopping lists
- Everyone with the code has equal access

## Getting Started

### Running the Server

```bash
npm install
npm start
```

The server will start at http://localhost:3000 by default.

### Basic Usage

1. **Sign Up**: Go to /signup
   - Enter your name, email, nickname, family name, and family code
   - Click "Create Account"
   - You'll be automatically logged in and taken to the app

2. **Sign In**: Go to /login
   - Enter your email and family code
   - Click "Sign In"
   - You'll be taken to the app

3. **Forgot Family Code**: On login page
   - Click "Forgot Family Code?"
   - Enter your email in the modal
   - Click "Send Code"
   - Check your email for your family code

## Configuration

### Development Mode (Default)

No configuration needed! Email sending will be logged to the console.

```bash
npm start
```

Output:
```
⚠️  Using mock email transporter for development. Set SMTP_HOST, SMTP_USER, SMTP_PASS for production emails.
✉️  Email sent to test@example.com (Family code: FAMILYCODE123)
```

### Production Mode

Set environment variables to enable real email sending:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_USER=your-email@gmail.com
export SMTP_PASS=your-app-password
export SMTP_PORT=587
export SMTP_SECURE=false
export SMTP_FROM=noreply@cartly.com
export PORT=3000

npm start
```

**Recommended Email Providers:**
- Gmail: `smtp.gmail.com:587` (requires App Password)
- SendGrid: `smtp.sendgrid.net:587`
- Mailgun: `smtp.mailgun.org:587`
- Amazon SES: `email-smtp.region.amazonaws.com:587`

## API Endpoints

### Register User on Server
```
POST /api/register-user
Content-Type: application/json

{
  "email": "user@example.com",
  "nickname": "JohnDoe",
  "familyCode": "FAMILY123",
  "name": "John Doe"
}

Response:
{
  "success": true,
  "message": "User registered on server"
}
```

### Send Family Code via Email
```
POST /api/send-family-code
Content-Type: application/json

{
  "email": "user@example.com"
}

Response:
{
  "success": true,
  "message": "Family code sent to your email"
}
```

## Data Storage

### Client-Side (localStorage)
- User objects include: name, email, nickname, familyCode, createdAt
- Shopping lists stored per family code
- Persists across browser sessions for logged-in users

### Server-Side (users-db.json)
- Email-to-family-code mapping for password recovery
- Created automatically on first user registration
- JSON format: `{ "email@example.com": { email, nickname, familyCode, name, registeredAt } }`

## Security

🔒 **Security Features**
- Email validation on client and server
- Duplicate email prevention
- Family code acts as shared secret (no passwords)
- Forgot code endpoint doesn't reveal if email exists (security best practice)
- Guest mode uses sessionStorage (not persisted)
- CORS-protected endpoints

## Troubleshooting

### Emails not sending in production?
- Check that SMTP environment variables are set correctly
- Verify network access to SMTP server
- Check application credentials with email provider
- Gmail requires "App Password" (not regular password)

### Can't log in with email?
- Verify email spelling matches signup
- Make sure family code is correct (case-sensitive)
- Try clicking "Forgot Family Code?" to recover

### "Email already registered" error?
- This email is already used by another account
- Use a different email or recover access via "Forgot Family Code?"

### How do I change my email?
- Currently not supported (future feature)
- Work around: Create new account with different email, transfer list manually

## Browser Support

✅ Chrome, Edge, Safari, Firefox (desktop)
✅ Chrome Mobile, Safari iOS, Firefox Mobile
✅ PWA support (installable on home screen)

## Session Management

**Logged-in Users (localStorage):**
- Session persists across browser closing
- User stays logged in until logout button clicked
- Data synced across browser tabs

**Guest Users (sessionStorage):**
- Session lasts only during current browser session
- Data cleared when browser closes
- Cannot access lists after browser restart

## Compatibility

- Works offline for existing data
- Needs internet to send recovery emails
- Email sending requires server running (not in file:// mode)

## Support & Feedback

For issues or questions:
1. Check console for error messages
2. Verify server is running: `npm start`
3. Test email endpoints with curl (see API Endpoints section)
4. Check environment variables are set (for production email)

## Future Enhancements

- [ ] Email verification during signup
- [ ] Password-based login option
- [ ] Two-factor authentication
- [ ] Rate limiting on password recovery
- [ ] Email change functionality
- [ ] Email preferences/notification settings
- [ ] SMS-based authentication
- [ ] Social login (Google, Apple, etc.)
