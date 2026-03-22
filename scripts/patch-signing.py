#!/usr/bin/env python3
"""Patch Android build.gradle to use release signing config."""

import sys
import os

gradle_path = sys.argv[1] if len(sys.argv) > 1 else 'apps/mobile/android/app/build.gradle'

if not os.path.exists(gradle_path):
    print(f"build.gradle not found at {gradle_path}")
    sys.exit(1)

with open(gradle_path, 'r') as f:
    content = f.read()

# Add release signing config if not present
if 'release {' not in content or 'storeFile' not in content:
    signing_block = """
    signingConfigs {
        release {
            storeFile file(findProperty('WHATSON_UPLOAD_STORE_FILE') ?: '../android-keystore.jks')
            storePassword findProperty('WHATSON_UPLOAD_STORE_PASSWORD') ?: ''
            keyAlias findProperty('WHATSON_UPLOAD_KEY_ALIAS') ?: ''
            keyPassword findProperty('WHATSON_UPLOAD_KEY_PASSWORD') ?: ''
        }
    }
"""
    content = content.replace('buildTypes {', signing_block + '    buildTypes {')

# Use release signing for release builds
content = content.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release')

with open(gradle_path, 'w') as f:
    f.write(content)

print('build.gradle patched for release signing')
