import jwt from 'jsonwebtoken';
import cfg from '../config/index.js';

const auth = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const token = header.split(' ')[1];

    const decoded = jwt.verify(token, cfg.jwt.secret);

    req.user = decoded;

    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export default auth;