import React from 'react';
import { BaseToast, ErrorToast, ToastConfig } from 'react-native-toast-message';
import { View } from 'react-native';

export const toastConfig: ToastConfig = {
  success: (props) => (
    <BaseToast
      {...props}
      style={{ 
        borderLeftColor: '#10b981', // Emerald 500
        borderLeftWidth: 10,
        height: 70,
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '700',
        color: '#064e3b' // Emerald 900
      }}
      text2Style={{
        fontSize: 14,
        color: '#065f46' // Emerald 800
      }}
    />
  ),
  error: (props) => (
    <ErrorToast
      {...props}
      style={{ 
        borderLeftColor: '#ef4444', // Red 500
        borderLeftWidth: 10,
        height: 70,
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '700',
        color: '#7f1d1d' // Red 900
      }}
      text2Style={{
        fontSize: 14,
        color: '#991b1b' // Red 800
      }}
    />
  ),
  info: (props) => (
    <BaseToast
      {...props}
      style={{ 
        borderLeftColor: '#3b82f6', // Blue 500
        borderLeftWidth: 10,
        height: 70,
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{
        fontSize: 16,
        fontWeight: '700',
        color: '#1e3a8a' // Blue 900
      }}
      text2Style={{
        fontSize: 14,
        color: '#1e40af' // Blue 800
      }}
    />
  ),
};
