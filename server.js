const express = require('express');
const mongoose = require('mongoose');
const ShortUrl = require('./models/shortUrl');
const User = require('./models/user');
const app = express();
const session = require('express-session');

// Connect to MongoDB
mongoose.connect('mongodb://localhost/urlShortener', {
  useNewUrlParser: true, useUnifiedTopology: true
});

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

// Express-session middleware to handle user sessions
app.use(session({
  secret: 'your-secret-key',
  resave: true,
  saveUninitialized: true,
}));

// USER ROUTES //
app.get('/', async (req, res) => {
  try {
    const shortUrls = await ShortUrl.find();
    let user;

    // Pass user information to the template if user is authenticated
    if (req.session.userId) {
      user = await User.findById(req.session.userId);
    }

    res.render('index', { shortUrls, user });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});
// Middleware to check if the user is authenticated
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
};

// Login Route
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Find the user by username
    const user = await User.findOne({ username });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).send('Invalid username or password');
    }

    // Set user session upon successful login
    req.session.userId = user._id;

    // Redirect to the index page on successful login
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  // Clear user session upon logout
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect('/login'); 
  });
});

// Registration route
app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Check if the username already exists
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.status(400).send('Username already exists');
    }

    // Create new user
    const newUser = await User.create({ username, password });

    // Associate new user to the short URL
    req.session.userId = newUser.id;

    res.redirect('/login'); // Redirect to the login page after successful registration
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

const requireLinkOwner = async (req, res, next) => {
  try {
    const shortUrl = await ShortUrl.findById(req.params.id);

    if (!shortUrl || shortUrl.user.toString() !== req.session.userId) {
      return res.status(403).send('User is not authorized to delete this link');
    }

    next();
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
};

// URL ROUTES //

// Create new shortUrl associated with the user
app.post('/shortUrls', requireAuth, async (req, res) => {
  try {
    // Get the user ID from the session
    const userId = req.session.userId;

    // Create a new ShortUrl associated with the user
    const shortUrl = await ShortUrl.create({ full: req.body.fullUrl, user: userId });

    // Update the user's shortUrls array with the created shortUrl
    const user = await User.findByIdAndUpdate(userId, { $push: { shortUrls: shortUrl._id } }, { new: true });

    res.status(200).send(shortUrl)
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/:shortUrl', async (req, res) => {
  const shortUrl = await ShortUrl.findOne({ short: req.params.shortUrl });
  if (!shortUrl) return res.sendStatus(404);

  shortUrl.clicks++;
  shortUrl.save();

  res.redirect(shortUrl.full);
});

// Decode short URL
app.get('/decode/:shortUrl', async (req, res) => {
  try {
    const shortUrl = await ShortUrl.findOne({ short: req.params.shortUrl });
    if (!shortUrl) return res.sendStatus(404);

    // Return details about the short URL
    res.json({
      full: shortUrl.full,
      short: shortUrl.short,
      clicks: shortUrl.clicks,
      date: shortUrl.date,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Delete shortUrl associated with the user
app.delete('/shortUrls/:id/delete', requireAuth, requireLinkOwner, async (req, res) => {
  try {
    const shortUrl = await ShortUrl.findOne({ _id: req.params.id, user: req.session.userId });

    if (!shortUrl) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    const deletedShortUrl = await shortUrl.deleteOne();

    if (deletedShortUrl) {
      // Remove the deleted ShortUrl's ID from the user's shortUrls array
      await User.findByIdAndUpdate(req.session.userId, { $pull: { shortUrls: shortUrl._id } });
      res.redirect('/');
    } else {
      res.status(500).json({ error: 'Failed to delete Short URL' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(process.env.PORT || 3000);
