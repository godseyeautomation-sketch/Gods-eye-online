<?php
// server-health.php
// Diagnostic tool for Klint Studio Proxy

header("Content-Type: text/plain");

echo "=== Hostinger PHP Diagnostic ===\n";
echo "Timestamp: " . date("Y-m-d H:i:s") . "\n";
echo "PHP Version: " . phpversion() . "\n";
echo "Server Software: " . $_SERVER['SERVER_SOFTWARE'] . "\n\n";

echo "=== Configuration ===\n";
echo "display_errors: " . ini_get('display_errors') . "\n";
echo "max_execution_time (Default): " . ini_get('max_execution_time') . "\n";
set_time_limit(300);
echo "max_execution_time (Attempted Override to 300): " . ini_get('max_execution_time') . "\n";
echo "memory_limit: " . ini_get('memory_limit') . "\n\n";

echo "=== Extensions ===\n";
echo "CURL: " . (extension_loaded('curl') ? "OK" : "MISSING") . "\n";
echo "OpenSSL: " . (extension_loaded('openssl') ? "OK" : "MISSING") . "\n";
echo "JSON: " . (extension_loaded('json') ? "OK" : "MISSING") . "\n\n";

echo "=== Connectivity Test ===\n";
$google = @file_get_contents("https://www.google.com");
echo "Access to External Web (Google): " . ($google ? "OK" : "BLOCKED") . "\n";

echo "=== File Check ===\n";
$files = ['vertex-proxy.php', 'service-account.json'];
foreach ($files as $f) {
    echo "$f: " . (file_exists(__DIR__ . '/' . $f) ? "FOUND" : "MISSING") . "\n";
}

echo "\n=== status ===\n";
echo "READY_TO_SERVE\n";
?>