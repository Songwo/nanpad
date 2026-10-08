export interface TotpStatus {
  configured: boolean;
  issuer: string;
  label: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
}

export interface TotpBridge {
  status(assetId: string): Promise<TotpStatus>;
  configure(input: { assetId: string; secret: string }): Promise<TotpStatus>;
  code(assetId: string): Promise<{
    code: string;
    remaining: number;
    expiresAt: number;
    period: number;
  }>;
  remove(assetId: string): Promise<void>;
}
