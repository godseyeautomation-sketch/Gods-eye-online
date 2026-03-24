<?php
// vertex-proxy.php - Hosted on Hostinger
// "Hidden API Key" Version

// ==========================================
// 1. PASTE YOUR GOOGLE API KEY HERE
// ==========================================
$GOOGLE_API_KEY = "";
// ^^^ Replace this text with your actual key from https://aistudio.google.com/app/apikey

// Configuration
ini_set('display_errors', 0);
set_time_limit(300); // 5 Minutes
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
header("Content-Type: application/json");

// Handle Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Version Check
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['status' => 'ok', 'mode' => 'api_key_hidden']);
    exit;
}

// Error Handler
function jsonExceptionHandler($e)
{
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
    exit;
}
set_exception_handler('jsonExceptionHandler');

try {
    // Validate Key
    if (strpos($GOOGLE_API_KEY, 'PASTE_') !== false || empty($GOOGLE_API_KEY)) {
        throw new Exception("Server Configuration Error: API Key not set in vertex-proxy.php");
    }

    // Get input
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input)
        throw new Exception("Invalid JSON Body");

    $model = $input['model'] ?? 'gemini-1.5-pro-latest';
    $prompt = $input['prompt'] ?? '';

    // Fix Model Name for Public API (generativelanguage.googleapis.com)
    // The public API uses slightly different model names sometimes, but typically 'models/gemini-1.5-pro'
    // We map 'gemini-3-pro...' to 'gemini-1.5-pro' or similar if 3.0 isn't public yet, 
    // BUT user says they have access. We will try the exact model ID first.

    // Construct URL for Public API
    $apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key={$GOOGLE_API_KEY}";

    // Construct Payload
    $parts = [['text' => $prompt]];
    if (!empty($input['baseImages'])) {
        foreach ($input['baseImages'] as $b64) {
            $clean = preg_replace('/^data:image\/\w+;base64,/', '', $b64);
            $parts[] = ['inlineData' => ['mimeType' => 'image/jpeg', 'data' => $clean]];
        }
    }

    $requestBody = [
        'contents' => [['parts' => $parts]],
        'generationConfig' => [
            'responseModalities' => ['IMAGE']
            // aspectRatio is not strictly supported in 'generateContent' public API image gen yet?
            // Actually, 'imagen' and 'gemini' differ. 
            // If user is using Gemini 3 Preview, it follows generateContent.
        ]
    ];

    // Aspect Ratio hack for Prompt if API doesn't support param
    if (!empty($input['aspectRatio'])) {
        $parts[0]['text'] .= " --aspect-ratio " . $input['aspectRatio'];
    }

    // Execute Call
    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 120);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestBody));

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($httpCode !== 200) {
        // Pass through error
        http_response_code($httpCode);
        echo $response ?: json_encode(['error' => 'API Request Failed', 'details' => $curlError]);
        exit;
    }

    // Success
    echo $response;

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>