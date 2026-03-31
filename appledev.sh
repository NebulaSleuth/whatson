#!/bin/bash
# =============================================================================
# Whats On — Apple TV Development Guide
# =============================================================================
#
# This script documents all commands needed to build, debug, and publish
# the Apple TV (tvOS) app. Run individual sections as needed.
#
# Prerequisites:
#   - macOS with Xcode 15+ installed
#   - Node.js 20+ (install via: brew install node@20)
#   - CocoaPods (install via: brew install cocoapods)
#   - Apple Developer account (for device builds and App Store)
#
# The backend API must be running and accessible from the Apple TV.
# Set EXPO_PUBLIC_API_URL to point to your backend.
#
# =============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"

# Backend API URL — change this to your backend's IP
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://www.nebulasleuth.com:3001/api}"

# =============================================================================
# 1. INITIAL SETUP (run once)
# =============================================================================
setup() {
    echo "=== Setting up Apple TV development ==="

    # Install dependencies
    cd "$PROJECT_ROOT"
    npm install

    # Generate native iOS/tvOS project
    cd "$MOBILE_DIR"
    WHATSON_TV=1 npx expo prebuild --platform ios --clean

    # Install CocoaPods
    cd "$MOBILE_DIR/ios"
    pod install

    echo ""
    echo "=== Setup complete ==="
    echo "Run: $0 simulator    — to build and run in tvOS Simulator"
    echo "Run: $0 device       — to build and run on a real Apple TV"
}

# =============================================================================
# 2. BUILD & RUN IN tvOS SIMULATOR
# =============================================================================
simulator() {
    echo "=== Building for Apple TV Simulator ==="
    cd "$MOBILE_DIR"

    # Build and launch in simulator
    WHATSON_TV=1 npx expo run:ios

    # The app will open in the Apple TV simulator.
    # Use the Siri Remote in the simulator:
    #   - Arrow keys = D-pad navigation
    #   - Enter = Select/Press
    #   - Escape = Menu/Back
    #   - Option+click = touch surface gestures
}

# =============================================================================
# 3. BUILD & RUN ON REAL APPLE TV (requires Apple Developer account)
# =============================================================================
device() {
    echo "=== Building for Apple TV device ==="
    cd "$MOBILE_DIR"

    # Make sure your Apple TV is:
    #   1. On the same network as this Mac
    #   2. Paired: Xcode → Window → Devices and Simulators → add Apple TV
    #   3. Developer mode enabled on Apple TV:
    #      Settings → Privacy & Security → Developer Mode → ON

    # Build and deploy to connected Apple TV
    WHATSON_TV=1 npx expo run:ios --device

    # If you have multiple devices, specify by name:
    # WHATSON_TV=1 npx expo run:ios --device "Apple TV"
}

# =============================================================================
# 4. START METRO BUNDLER (for development with hot reload)
# =============================================================================
metro() {
    echo "=== Starting Metro bundler ==="
    cd "$MOBILE_DIR"
    WHATSON_TV=1 npx expo start "$@"
}

# =============================================================================
# 5. DEBUG
# =============================================================================
debug() {
    echo "=== Debug commands ==="
    echo ""
    echo "Metro bundler (JS hot reload):"
    echo "  $0 metro          — start Metro bundler"
    echo "  $0 metro --clear  — start with cache cleared"
    echo ""
    echo "View device logs:"
    echo "  xcrun simctl spawn booted log stream --predicate 'subsystem == \"com.extrastrength.whatson\"'"
    echo ""
    echo "Open React Native debugger (in simulator, press Cmd+D):"
    echo "  - 'Open Debugger' opens Chrome DevTools"
    echo "  - 'Show Element Inspector' for layout debugging"
    echo ""
    echo "Open Xcode project directly (for native debugging):"
    echo "  open $MOBILE_DIR/ios/WhatsOnTV.xcworkspace"
    echo ""
    echo "Clean rebuild (if things are broken):"
    echo "  cd $MOBILE_DIR && rm -rf ios && WHATSON_TV=1 npx expo prebuild --platform ios --clean && cd ios && pod install"
    echo ""
    echo "List available simulators:"
    echo "  xcrun simctl list devices available | grep -i tv"
    echo ""
    echo "Boot simulator manually:"
    echo "  xcrun simctl boot 'Apple TV 4K (3rd generation)'"
    echo "  open -a Simulator"
}

# =============================================================================
# 5. BUILD FOR APP STORE / TESTFLIGHT
# =============================================================================
archive() {
    echo "=== Building archive for App Store / TestFlight ==="
    cd "$MOBILE_DIR"

    # Ensure native project is up to date
    WHATSON_TV=1 npx expo prebuild --platform ios

    # Option A: Build via Xcode (recommended for first time)
    echo ""
    echo "Option A — Xcode (GUI):"
    echo "  1. open ios/WhatsOnTV.xcworkspace"
    echo "  2. Select 'Any Apple TV' as destination"
    echo "  3. Product → Archive"
    echo "  4. Window → Organizer → Distribute App"
    echo ""

    # Option B: Build via command line
    echo "Option B — Command line:"
    echo "  cd $MOBILE_DIR/ios"
    echo ""
    echo "  # Build archive"
    echo "  xcodebuild archive \\"
    echo "    -workspace WhatsOnTV.xcworkspace \\"
    echo "    -scheme WhatsOnTV \\"
    echo "    -sdk appletvos \\"
    echo "    -configuration Release \\"
    echo "    -archivePath build/WhatsOnTV.xcarchive \\"
    echo "    CODE_SIGN_IDENTITY='Apple Distribution' \\"
    echo "    DEVELOPMENT_TEAM='YOUR_TEAM_ID'"
    echo ""
    echo "  # Export IPA for App Store"
    echo "  xcodebuild -exportArchive \\"
    echo "    -archivePath build/WhatsOnTV.xcarchive \\"
    echo "    -exportPath build/export \\"
    echo "    -exportOptionsPlist ExportOptions.plist"
    echo ""
    echo "  # Upload to App Store Connect"
    echo "  xcrun altool --upload-app \\"
    echo "    -f build/export/WhatsOnTV.ipa \\"
    echo "    -t appletvos \\"
    echo "    -u 'your@apple.id' \\"
    echo "    -p '@keychain:AC_PASSWORD'"
    echo ""

    # Option C: EAS Build (cloud)
    echo "Option C — EAS Build (Expo cloud build):"
    echo "  npx eas build --platform ios --profile production"
    echo "  npx eas submit --platform ios"
}

# =============================================================================
# 6. EXPORT OPTIONS PLIST (for command-line archive export)
# =============================================================================
create_export_plist() {
    cat > "$MOBILE_DIR/ios/ExportOptions.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>destination</key>
    <string>upload</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
PLIST
    echo "Created ExportOptions.plist"
}

# =============================================================================
# 7. INSTALL tvOS SIMULATOR (if not already installed)
# =============================================================================
install_simulator() {
    echo "=== Installing tvOS Simulator runtime ==="
    xcodebuild -downloadPlatform tvOS
    echo ""
    echo "Available tvOS simulators:"
    xcrun simctl list devices available | grep -i tv
}

# =============================================================================
# 8. USEFUL XCODE SETTINGS
# =============================================================================
xcode_tips() {
    echo "=== Xcode Tips for Apple TV ==="
    echo ""
    echo "Simulator keyboard shortcuts:"
    echo "  Arrow keys     — D-pad (Up/Down/Left/Right)"
    echo "  Enter/Return   — Select (press center of remote)"
    echo "  Escape          — Menu button (back)"
    echo "  Shift+Cmd+H    — Home button"
    echo "  Shift+Cmd+R    — Show/hide Siri Remote overlay"
    echo "  Option+click   — Touch surface gesture"
    echo ""
    echo "Pairing a real Apple TV for development:"
    echo "  1. Apple TV and Mac must be on the same network"
    echo "  2. Xcode → Window → Devices and Simulators"
    echo "  3. Click '+' and select your Apple TV"
    echo "  4. Enter the PIN shown on the Apple TV screen"
    echo ""
    echo "Enable Developer Mode on Apple TV:"
    echo "  Settings → Privacy & Security → Developer Mode → ON"
    echo "  (requires restart)"
    echo ""
    echo "App configuration:"
    echo "  Bundle ID:       com.whatson.tv"
    echo "  tvOS target:     15.1+"
    echo "  Architecture:    arm64"
    echo "  Display name:    Whats On TV"
}

# =============================================================================
# MAIN — run a section by name
# =============================================================================
case "${1:-help}" in
    setup)             setup ;;
    simulator|sim)     simulator ;;
    device|dev)        device ;;
    metro|start)       shift; metro "$@" ;;
    debug)             debug ;;
    archive|publish)   archive ;;
    export-plist)      create_export_plist ;;
    install-simulator) install_simulator ;;
    tips|xcode)        xcode_tips ;;
    help|*)
        echo "Usage: $0 <command>"
        echo ""
        echo "Commands:"
        echo "  setup              Initial setup (npm install, prebuild, pod install)"
        echo "  simulator (sim)    Build & run in Apple TV Simulator"
        echo "  device (dev)       Build & run on real Apple TV"
        echo "  metro (start)      Start Metro bundler (JS hot reload)"
        echo "  debug              Show debugging tips and commands"
        echo "  archive (publish)  Build for App Store / TestFlight"
        echo "  export-plist       Create ExportOptions.plist for CLI archive"
        echo "  install-simulator  Download tvOS Simulator runtime"
        echo "  tips (xcode)       Xcode tips and keyboard shortcuts"
        echo ""
        echo "Environment variables:"
        echo "  EXPO_PUBLIC_API_URL  Backend API URL (default: http://www.nebulasleuth.com:3001/api)"
        echo ""
        echo "Quick start:"
        echo "  $0 setup       # First time only"
        echo "  $0 simulator   # Build and run"
        ;;
esac
