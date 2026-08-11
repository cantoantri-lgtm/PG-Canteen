export const isWebAuthnSupported = () => {
  return window.PublicKeyCredential !== undefined && typeof window.PublicKeyCredential === 'function';
};

export const registerBiometric = async (phone: string, fullName: string) => {
  if (!isWebAuthnSupported()) {
    throw new Error('Trình duyệt không hỗ trợ sinh trắc học.');
  }

  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);
  const userId = new Uint8Array(16);
  window.crypto.getRandomValues(userId);

  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: {
          name: "PG Canteen",
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: phone,
          displayName: fullName
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" }
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
      }
    });

    if (credential) {
      // @ts-ignore
      const rawId = Array.from(new Uint8Array(credential.rawId))
        .map(b => String.fromCharCode(b))
        .join('');
      const base64Id = btoa(rawId);
      
      localStorage.setItem('biometric_cred_id', base64Id);
      localStorage.setItem('biometric_phone', phone);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Lỗi đăng ký sinh trắc học:', error);
    throw error;
  }
};

export const authenticateBiometric = async () => {
  if (!isWebAuthnSupported()) {
    throw new Error('Trình duyệt không hỗ trợ sinh trắc học.');
  }

  const storedCredId = localStorage.getItem('biometric_cred_id');
  const storedPhone = localStorage.getItem('biometric_phone');

  if (!storedCredId || !storedPhone) {
    throw new Error('Chưa thiết lập đăng nhập sinh trắc học cho thiết bị này.');
  }

  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const rawId = atob(storedCredId);
  const credentialId = new Uint8Array(rawId.length);
  for (let i = 0; i < rawId.length; i++) {
    credentialId[i] = rawId.charCodeAt(i);
  }

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        rpId: window.location.hostname,
        allowCredentials: [{
          type: "public-key",
          id: credentialId
        }],
        userVerification: "required",
        timeout: 60000
      }
    });

    if (assertion) {
      return storedPhone;
    }
    return null;
  } catch (error) {
    console.error('Lỗi xác thực sinh trắc học:', error);
    throw error;
  }
};
