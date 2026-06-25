const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
    host: '127.0.0.1',
    port: 25,
    secure: false,
    tls: { rejectUnauthorized: false },
    debug: true,
    logger: true
});
transporter.verify().then(console.log).catch(console.error);
