const express = require('express');
const logic = require('./logic');

const router = express.Router();

router.post('/add', logic.addUrl);
router.get('/whatis/:segment', logic.whatIs);
router.get('/:segment', logic.getUrl);

module.exports = router;
