import '@expo/vector-icons';
import '@react-navigation/native';
import '@react-navigation/native-stack';
import 'expo-crypto';
import 'expo-font';
import 'expo-status-bar';
import 'expo-system-ui';
import 'react-native-safe-area-context';
import 'react-native-screens';
import 'react-native-webrtc';

import { registerRootComponent } from 'expo';
import React from 'react';
import { Text, View } from 'react-native';
import { protocolProbe } from '@private/protocol';

function App() {
  return React.createElement(
    View,
    null,
    React.createElement(Text, null, protocolProbe),
  );
}

registerRootComponent(App);
