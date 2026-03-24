<?php
// Hostinger FTP Upload Receiver (Simplified & Robust)
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');
ini_set('display_errors', 0); // Prevent PHP warnings from breaking JSON

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$baseDir = __DIR__; // current directory (public_html)
$relativePath = $_POST['path'] ?? '';

// Basic Validation
if (empty($relativePath) || empty($_FILES['file'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing file or path']);
    exit();
}

// Security: Prevent directory traversal
if (strpos($relativePath, '..') !== false) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid path']);
    exit();
}

$targetFullPath = $baseDir . '/' . $relativePath;
$targetDir = dirname($targetFullPath);

// Create directory (Recursive)
if (!file_exists($targetDir)) {
    // Attempt creation - 0777 is standard for shared hosting write access
    if (!mkdir($targetDir, 0777, true)) {
        // If mkdir fails, check if it actually exists (race condition)
        if (!is_dir($targetDir)) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to create directory', 'path' => $targetDir]);
            exit();
        }
    }
}

// Move File
if (move_uploaded_file($_FILES['file']['tmp_name'], $targetFullPath)) {
    $publicUrl = 'https://' . $_SERVER['HTTP_HOST'] . '/' . $relativePath;
    echo json_encode([
        'success' => true,
        'url' => $publicUrl
    ]);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Move uploaded file failed', 'path' => $targetFullPath]);
}
?>