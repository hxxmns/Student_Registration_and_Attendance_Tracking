CREATE DATABASE IF NOT EXISTS student_information_system;
USE student_information_system;

-- USERS TABLE
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL UNIQUE,
    username VARCHAR(30) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    userType ENUM('STUDENT', 'ADMIN', 'MODERATOR') NOT NULL DEFAULT 'STUDENT',
    isRegistered BOOLEAN NOT NULL DEFAULT FALSE,

    -- Generated helper columns to enforce single-account limits
    admin_slot VARCHAR(10) GENERATED ALWAYS AS (IF(userType = 'ADMIN', 'ADMIN', NULL)) STORED,
    mod_slot VARCHAR(10) GENERATED ALWAYS AS (IF(userType = 'MODERATOR', 'MODERATOR', NULL)) STORED,

    -- Guarantees maximum 1 ADMIN and 1 MODERATOR
    CONSTRAINT uq_single_admin UNIQUE (admin_slot),
    CONSTRAINT uq_single_mod UNIQUE (mod_slot),

    -- Restricts boolean registration status strictly to STUDENT roles
    CONSTRAINT chk_student_registration
        CHECK (userType = 'STUDENT' OR isRegistered = FALSE)
);

-- STUDENTS TABLE
-- userId links a student record to the STUDENT account that registered it
-- (NULL when an admin or moderator registered the student for someone else).
CREATE TABLE students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    studentID VARCHAR(15) NOT NULL UNIQUE,
    fname VARCHAR(30) NOT NULL,
    lname VARCHAR(30) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    course VARCHAR(100) NOT NULL,
    yrAndSec VARCHAR(5) NOT NULL,
    profile LONGBLOB NULL,
    dateRegistered DATETIME NOT NULL,
    userId INT NULL,
    CONSTRAINT uq_students_user UNIQUE (userId),
    CONSTRAINT fk_students_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_students_class (course, yrAndSec)
);

-- PASSWORD RESET TOKENS
CREATE TABLE password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ATTENDANCE TABLE
-- One row per student per day. Days that are not "required" for the class
-- (see class_days) are ignored when attendance is counted.
CREATE TABLE attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    attendDate DATE NOT NULL,
    status ENUM('PRESENT', 'ABSENT', 'EXCUSED', 'EXEMPTED') NOT NULL DEFAULT 'PRESENT',
    timeIn TIME NULL,
    source ENUM('SCAN', 'MANUAL') NOT NULL DEFAULT 'SCAN',
    recordedBy INT NULL,
    CONSTRAINT uq_attendance_day UNIQUE (student_id, attendDate),
    CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_attendance_user FOREIGN KEY (recordedBy) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_attendance_date (attendDate)
);

-- CLASS DAYS TABLE
CREATE TABLE class_days (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dayDate DATE NOT NULL,
    course VARCHAR(100) NOT NULL DEFAULT '',
    yrAndSec VARCHAR(5) NOT NULL DEFAULT '',
    status ENUM('REQUIRED', 'NO_CLASS', 'HOLIDAY', 'CANCELLED', 'OTHER') NOT NULL,
    modality ENUM('FACE_TO_FACE', 'ONLINE', 'BLENDED') NOT NULL DEFAULT 'FACE_TO_FACE',
    -- How the class is held. Only meaningful when status = 'REQUIRED' (Has class).
    --   FACE_TO_FACE = students go to school      ONLINE = held online (general)
    --   SYNCHRONOUS  = live online, same time      ASYNCHRONOUS = online, students work on their own time
    classType ENUM('FACE_TO_FACE', 'ONLINE', 'SYNCHRONOUS', 'ASYNCHRONOUS') NOT NULL DEFAULT 'FACE_TO_FACE',
    note VARCHAR(100) NULL,
    setBy INT NULL,
    CONSTRAINT uq_class_day UNIQUE (dayDate, course, yrAndSec),
    CONSTRAINT chk_class_scope CHECK (yrAndSec = '' OR course <> ''),
    CONSTRAINT fk_class_days_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL
);

-- SCHOOL YEARS > SEMESTERS > TERMS
-- Set only by ADMIN / MODERATOR. Hierarchy: a school year (e.g. "2025-2026") has semesters ("1st Semester"),
-- and a semester has terms ("Midterm", "Finals"). Deleting a parent deletes its children.
CREATE TABLE school_years (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE,
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    setBy INT NULL,
    CONSTRAINT chk_sy_dates CHECK (endDate >= startDate),
    CONSTRAINT fk_sy_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_sy_dates (startDate, endDate)
);

CREATE TABLE semesters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    schoolYearId INT NOT NULL,
    name VARCHAR(40) NOT NULL,
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    setBy INT NULL,
    CONSTRAINT uq_semester_name UNIQUE (schoolYearId, name),
    CONSTRAINT chk_sem_dates CHECK (endDate >= startDate),
    CONSTRAINT fk_sem_year FOREIGN KEY (schoolYearId) REFERENCES school_years(id) ON DELETE CASCADE,
    CONSTRAINT fk_sem_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_sem_dates (startDate, endDate)
);

CREATE TABLE terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    semesterId INT NOT NULL,
    name VARCHAR(40) NOT NULL,
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    setBy INT NULL,
    CONSTRAINT uq_term_name UNIQUE (semesterId, name),
    CONSTRAINT chk_term_dates CHECK (endDate >= startDate),
    CONSTRAINT fk_term_sem FOREIGN KEY (semesterId) REFERENCES semesters(id) ON DELETE CASCADE,
    CONSTRAINT fk_term_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_term_dates (startDate, endDate)
);

-- CALENDAR EVENTS
CREATE TABLE calendar_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    category ENUM('EVENT', 'ACTIVITY', 'HOLIDAY', 'EXAM') NOT NULL DEFAULT 'EVENT',
    startDate DATE NOT NULL,
    endDate DATE NOT NULL,
    note VARCHAR(255) NULL,
    setBy INT NULL,
    CONSTRAINT chk_event_dates CHECK (endDate >= startDate),
    CONSTRAINT fk_event_user FOREIGN KEY (setBy) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_event_dates (startDate, endDate)
);