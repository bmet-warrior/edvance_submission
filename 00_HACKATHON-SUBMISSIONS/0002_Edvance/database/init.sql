-- AI Discussion Forum Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    avatar_url VARCHAR(255)
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    views INTEGER DEFAULT 0,
    votes INTEGER DEFAULT 0
);

-- Answers table
CREATE TABLE IF NOT EXISTS answers (
    id SERIAL PRIMARY KEY,
    question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    content TEXT NOT NULL,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    votes INTEGER DEFAULT 0
);

-- Content table for uploaded educational materials
CREATE TABLE IF NOT EXISTS content (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    content_type VARCHAR(100),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT FALSE,
    extracted_text TEXT
);

-- Insert sample users
INSERT INTO users (username, email) VALUES
('alice_student', 'alice@university.edu'),
('bob_student', 'bob@university.edu'),
('charlie_student', 'charlie@university.edu'),
('diana_student', 'diana@university.edu'),
('eric_student', 'eric@university.edu');

-- Insert sample questions about Computer Science Fundamentals
INSERT INTO questions (user_id, title, content, tags) VALUES
(1, 'What is the difference between a stack and a queue?', 'I''m studying data structures and I''m confused about when to use a stack vs a queue. Can someone explain the key differences and provide real-world examples?', ARRAY['data-structures', 'algorithms', 'computer-science']),
(2, 'How does recursion work in programming?', 'I understand that recursion is when a function calls itself, but I''m having trouble visualizing how it works. Can someone break it down with a simple example?', ARRAY['recursion', 'programming', 'algorithms']),
(3, 'What are the main sorting algorithms and when to use each?', 'I know there are many sorting algorithms like bubble sort, quick sort, merge sort, etc. What are the time complexities and when should I use each one?', ARRAY['sorting', 'algorithms', 'complexity']),
(4, 'How do I implement a binary search tree?', 'I need to create a binary search tree for my assignment. Can someone show me a simple implementation in JavaScript or Python?', ARRAY['binary-search-tree', 'data-structures', 'implementation']),
(5, 'What is the difference between HTTP and HTTPS?', 'I''m learning about web protocols and I see both HTTP and HTTPS mentioned. What''s the difference and why is HTTPS more secure?', ARRAY['web-protocols', 'security', 'networking']);

-- Insert sample answers
INSERT INTO answers (question_id, user_id, content, is_ai_generated) VALUES
(1, 2, 'A stack follows LIFO (Last In, First Out) principle - like a stack of plates. You can only add or remove from the top. A queue follows FIFO (First In, First Out) - like a line of people. You add at the back and remove from the front. Stacks are great for undo operations, while queues are perfect for task scheduling.', FALSE),
(1, 3, 'Think of a stack like a browser''s back button - the last page you visited is the first one you go back to. A queue is like a printer queue - the first document sent is the first one printed.', FALSE),
(2, 1, 'Recursion is like Russian dolls - each doll contains a smaller version of itself. In programming, a recursive function solves a problem by breaking it into smaller, identical sub-problems. The key is having a base case to stop the recursion.', FALSE),
(3, 4, 'Quick sort is usually the best for general use (O(n log n) average). Merge sort is stable and predictable (O(n log n) always). Bubble sort is simple but slow (O(n²)). Use quick sort for most cases, merge sort when you need stability, and avoid bubble sort for large datasets.', FALSE),
(4, 5, 'Here''s a simple BST implementation in JavaScript: [code example would go here]', FALSE);

-- Insert sample content files
INSERT INTO content (filename, file_path, content_type) VALUES
('computer_science_basics.pdf', '/uploads/computer_science_basics.pdf', 'application/pdf'),
('algorithms_notes.txt', '/uploads/algorithms_notes.txt', 'text/plain'),
('data_structures_guide.md', '/uploads/data_structures_guide.md', 'text/markdown');

