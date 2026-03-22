#!/usr/bin/env python3
"""Patch Android build.gradle to use release signing config.

The Expo-generated build.gradle has:
  android {
      ...
      signingConfigs {
          debug { ... }
      }
      buildTypes {
          debug { signingConfig signingConfigs.debug }
          release {
              signingConfig signingConfigs.debug  <-- need to change this
              ...
          }
      }
  }

This script:
1. Adds a 'release' block inside the existing signingConfigs
2. Changes the release buildType to use signingConfigs.release
"""

import sys
import os

gradle_path = sys.argv[1] if len(sys.argv) > 1 else 'apps/mobile/android/app/build.gradle'

if not os.path.exists(gradle_path):
    print(f"build.gradle not found at {gradle_path}")
    sys.exit(1)

with open(gradle_path, 'r') as f:
    lines = f.readlines()

output = []
in_signing_configs = False
signing_configs_depth = 0
release_added = False

for i, line in enumerate(lines):
    stripped = line.strip()

    # Track when we're inside signingConfigs block
    if 'signingConfigs {' in stripped and 'buildTypes' not in stripped:
        in_signing_configs = True
        signing_configs_depth = 0

    if in_signing_configs:
        signing_configs_depth += line.count('{') - line.count('}')
        # When we're about to close signingConfigs, insert release config
        if signing_configs_depth <= 0 and not release_added:
            # Insert release config before the closing brace
            output.append('        release {\n')
            output.append("            storeFile file(findProperty('WHATSON_UPLOAD_STORE_FILE') ?: '../android-keystore.jks')\n")
            output.append("            storePassword findProperty('WHATSON_UPLOAD_STORE_PASSWORD') ?: ''\n")
            output.append("            keyAlias findProperty('WHATSON_UPLOAD_KEY_ALIAS') ?: ''\n")
            output.append("            keyPassword findProperty('WHATSON_UPLOAD_KEY_PASSWORD') ?: ''\n")
            output.append('        }\n')
            release_added = True
            in_signing_configs = False

    # Replace debug signing with release signing in the release buildType
    if 'signingConfig signingConfigs.debug' in line:
        # Check if this is inside a release block (look back for 'release {')
        for j in range(max(0, i - 5), i):
            if 'release {' in lines[j] or 'release{' in lines[j]:
                line = line.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release')
                break

    output.append(line)

with open(gradle_path, 'w') as f:
    f.writelines(output)

if release_added:
    print('build.gradle patched: added release signingConfig and updated release buildType')
else:
    print('Warning: could not find signingConfigs block to patch')
