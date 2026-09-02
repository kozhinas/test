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
