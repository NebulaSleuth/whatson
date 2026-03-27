import { Router } from 'express';
import * as users from '../services/users.js';

export const usersRouter = Router();

/** List all Plex home users */
usersRouter.get('/users', async (_req, res) => {
  try {
    const list = await users.listUsers();
    res.json({
      success: true,
      data: list.map((u) => ({
        id: u.id,
        title: u.title,
        thumb: u.thumb,
        admin: u.admin,
        hasPassword: u.hasPassword,
        restricted: u.restricted,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Select / switch to a user */
usersRouter.post('/users/select', async (req, res) => {
  try {
    const { userId, pin } = req.body;
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId is required' });
      return;
    }

    const token = await users.selectUser(userId, pin);
    // Return masked token as confirmation
    res.json({
      success: true,
      data: {
        userId,
        token: '••••' + token.slice(-4),
        selected: true,
      },
    });
  } catch (error) {
    const msg = (error as Error).message;
    // Plex returns 401 for wrong PIN
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      res.status(401).json({ success: false, error: 'Incorrect PIN' });
    } else {
      res.status(500).json({ success: false, error: msg });
    }
  }
});
