const express = require('express');
const sqlite3 = require('sqlite3');
const app = express();

const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run("CREATE TABLE users (id INT, username TEXT, password TEXT, role TEXT)");
    db.run("INSERT INTO users VALUES (1, 'admin', 'supersecret', 'admin')");
    db.run("INSERT INTO users VALUES (2, 'john_doe', 'password123', 'user')");
});

app.get('/api/users/search', (req, res) => {
    const username = req.query.username;
    const query = "SELECT id, username, role FROM users WHERE username = '" + username + "'";
    
    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: "Database error occurred" });
            return;
        }
        res.json(rows);
    });
});

app.listen(3000);