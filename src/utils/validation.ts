import type { PatientData, Vitals, ScannedDocItem } from '../types';

export interface ValidationResult<T = unknown> {
  valid: boolean;
  errors: string[];
  sanitizedData?: T;
}

const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;
const NAME_MAX_LENGTH = 100;
const NAME_MIN_LENGTH = 2;

function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/`/g, '')
    .replace(/\${/g, '')
    .trim();
}

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  return sanitizeString(input);
}

function sanitizePatientData(data: Partial<PatientData>): Partial<PatientData> {
  const sanitized: Partial<PatientData> = {};
  
  if (data.name) {
    sanitized.name = sanitizeString(data.name).slice(0, NAME_MAX_LENGTH);
  }
  if (data.phone) {
    sanitized.phone = data.phone.replace(/\D/g, '').slice(0, 10);
  }
  if (data.age !== undefined) {
    sanitized.age = Math.max(0, Math.min(120, Math.floor(Number(data.age))));
  }
  if (data.gender) {
    sanitized.gender = sanitizeString(data.gender);
  }
  if (data.address) {
    sanitized.address = sanitizeString(data.address).slice(0, 500);
  }
  if (data.emergencyContact) {
    sanitized.emergencyContact = sanitizeString(data.emergencyContact).slice(0, 100);
  }
  if (data.emergencyPhone) {
    sanitized.emergencyPhone = data.emergencyPhone.replace(/\D/g, '').slice(0, 10);
  }
  if (data.medicalHistory) {
    sanitized.medicalHistory = sanitizeString(data.medicalHistory).slice(0, 2000);
  }
  if (data.allergies) {
    sanitized.allergies = sanitizeString(data.allergies).slice(0, 1000);
  }
  if (data.currentMedications) {
    sanitized.currentMedications = sanitizeString(data.currentMedications).slice(0, 1000);
  }
  
  return sanitized;
}

export function validatePatientData(data: Partial<PatientData>): ValidationResult<Partial<PatientData>> {
  const errors: string[] = [];
  const sanitized = sanitizePatientData(data);

  if (!sanitized.name || sanitized.name.length < NAME_MIN_LENGTH) {
    errors.push(`Name is required and must be at least ${NAME_MIN_LENGTH} characters`);
  } else if (sanitized.name.length > NAME_MAX_LENGTH) {
    errors.push(`Name must not exceed ${NAME_MAX_LENGTH} characters`);
  }

  if (!sanitized.phone) {
    errors.push('Phone number is required');
  } else if (!INDIAN_PHONE_REGEX.test(sanitized.phone)) {
    errors.push('Phone number must be a valid 10-digit Indian mobile number starting with 6-9');
  }

  if (sanitized.age === undefined || sanitized.age === null) {
    errors.push('Age is required');
  } else if (sanitized.age < 0 || sanitized.age > 120) {
    errors.push('Age must be between 0 and 120');
  }

  if (sanitized.gender && !['male', 'female', 'other'].includes(sanitized.gender.toLowerCase())) {
    errors.push('Gender must be one of: male, female, other');
  }

  if (sanitized.emergencyPhone && sanitized.emergencyPhone.length > 0) {
    if (!INDIAN_PHONE_REGEX.test(sanitized.emergencyPhone)) {
      errors.push('Emergency contact phone must be a valid 10-digit Indian mobile number');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitized : undefined,
  };
}

function sanitizeVitals(vitals: Partial<Vitals>): Partial<Vitals> {
  const sanitized: Partial<Vitals> = {};
  
  if (vitals.bloodPressure) {
    sanitized.bloodPressure = sanitizeString(vitals.bloodPressure).slice(0, 20);
  }
  if (vitals.pulse !== undefined) {
    sanitized.pulse = Math.max(30, Math.min(200, Math.floor(Number(vitals.pulse))));
  }
  if (vitals.spo2 !== undefined) {
    sanitized.spo2 = Math.max(70, Math.min(100, Math.floor(Number(vitals.spo2))));
  }
  if (vitals.temperature !== undefined) {
    sanitized.temperature = Math.max(35, Math.min(42, Number(vitals.temperature.toFixed(1))));
  }
  if (vitals.respiratoryRate !== undefined) {
    sanitized.respiratoryRate = Math.max(5, Math.min(60, Math.floor(Number(vitals.respiratoryRate))));
  }
  if (vitals.weight !== undefined) {
    sanitized.weight = Math.max(0.5, Math.min(500, Number(vitals.weight.toFixed(1))));
  }
  if (vitals.height !== undefined) {
    sanitized.height = Math.max(20, Math.min(300, Math.floor(Number(vitals.height))));
  }
  if (vitals.bmi !== undefined) {
    sanitized.bmi = Math.max(5, Math.min(100, Number(vitals.bmi.toFixed(1))));
  }
  if (vitals.notes) {
    sanitized.notes = sanitizeString(vitals.notes).slice(0, 1000);
  }
  
  return sanitized;
}

export function validateVitals(vitals: Partial<Vitals>): ValidationResult<Partial<Vitals>> {
  const errors: string[] = [];
  const sanitized = sanitizeVitals(vitals);

  if (sanitized.bloodPressure) {
    const bpMatch = sanitized.bloodPressure.match(/^(\d{2,3})\/(\d{2,3})$/);
    if (!bpMatch) {
      errors.push('Blood pressure must be in format "systolic/diastolic" (e.g., "120/80")');
    } else {
      const systolic = parseInt(bpMatch[1], 10);
      const diastolic = parseInt(bpMatch[2], 10);
      if (systolic < 70 || systolic > 250) {
        errors.push('Systolic pressure must be between 70 and 250');
      }
      if (diastolic < 40 || diastolic > 150) {
        errors.push('Diastolic pressure must be between 40 and 150');
      }
      if (systolic <= diastolic) {
        errors.push('Systolic pressure must be greater than diastolic pressure');
      }
    }
  }

  if (sanitized.pulse !== undefined) {
    if (sanitized.pulse < 30 || sanitized.pulse > 200) {
      errors.push('Pulse must be between 30 and 200 bpm');
    }
  }

  if (sanitized.spo2 !== undefined) {
    if (sanitized.spo2 < 70 || sanitized.spo2 > 100) {
      errors.push('SpO2 must be between 70% and 100%');
    }
  }

  if (sanitized.temperature !== undefined) {
    if (sanitized.temperature < 35 || sanitized.temperature > 42) {
      errors.push('Temperature must be between 35°C and 42°C');
    }
  }

  if (sanitized.respiratoryRate !== undefined) {
    if (sanitized.respiratoryRate < 5 || sanitized.respiratoryRate > 60) {
      errors.push('Respiratory rate must be between 5 and 60 breaths/min');
    }
  }

  if (sanitized.weight !== undefined) {
    if (sanitized.weight < 0.5 || sanitized.weight > 500) {
      errors.push('Weight must be between 0.5 kg and 500 kg');
    }
  }

  if (sanitized.height !== undefined) {
    if (sanitized.height < 20 || sanitized.height > 300) {
      errors.push('Height must be between 20 cm and 300 cm');
    }
  }

  if (sanitized.bmi !== undefined) {
    if (sanitized.bmi < 5 || sanitized.bmi > 100) {
      errors.push('BMI must be between 5 and 100');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitized : undefined,
  };
}

function sanitizeScannedDoc(doc: Partial<ScannedDocItem>): Partial<ScannedDocItem> {
  const sanitized: Partial<ScannedDocItem> = {};
  
  if (doc.id) {
    sanitized.id = sanitizeString(doc.id).slice(0, 100);
  }
  if (doc.name) {
    sanitized.name = sanitizeString(doc.name).slice(0, 255);
  }
  if (doc.type) {
    sanitized.type = sanitizeString(doc.type).slice(0, 50);
  }
  if (doc.url) {
    sanitized.url = sanitizeString(doc.url).slice(0, 2048);
  }
  if (doc.uploadedAt) {
    sanitized.uploadedAt = sanitizeString(doc.uploadedAt).slice(0, 50);
  }
  if (doc.size !== undefined) {
    sanitized.size = Math.max(0, Math.floor(Number(doc.size)));
  }
  if (doc.mimeType) {
    sanitized.mimeType = sanitizeString(doc.mimeType).slice(0, 100);
  }
  if (doc.category) {
    sanitized.category = sanitizeString(doc.category).slice(0, 50);
  }
  if (doc.tags) {
    sanitized.tags = doc.tags
      .map(tag => sanitizeString(tag).slice(0, 50))
      .filter(tag => tag.length > 0)
      .slice(0, 20);
  }
  
  return sanitized;
}

export function validateScannedDoc(doc: Partial<ScannedDocItem>): ValidationResult<Partial<ScannedDocItem>> {
  const errors: string[] = [];
  const sanitized = sanitizeScannedDoc(doc);

  if (!sanitized.name || sanitized.name.trim().length === 0) {
    errors.push('Document name is required');
  } else if (sanitized.name.length > 255) {
    errors.push('Document name must not exceed 255 characters');
  }

  if (!sanitized.type || sanitized.type.trim().length === 0) {
    errors.push('Document type is required');
  }

  if (!sanitized.url || sanitized.url.trim().length === 0) {
    errors.push('Document URL is required');
  } else {
    try {
      new URL(sanitized.url);
    } catch {
      errors.push('Document URL must be a valid URL');
    }
  }

  if (sanitized.size !== undefined && sanitized.size < 0) {
    errors.push('Document size must be a positive number');
  }

  if (sanitized.size !== undefined && sanitized.size > 50 * 1024 * 1024) {
    errors.push('Document size must not exceed 50MB');
  }

  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  
  if (sanitized.mimeType && !allowedMimeTypes.includes(sanitized.mimeType)) {
    errors.push('Document type not allowed. Allowed types: PDF, JPEG, PNG, GIF, WebP, DOC, DOCX');
  }

  const allowedCategories = ['prescription', 'lab_report', 'imaging', 'discharge_summary', 'insurance', 'other'];
  if (sanitized.category && !allowedCategories.includes(sanitized.category.toLowerCase())) {
    errors.push(`Category must be one of: ${allowedCategories.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitized : undefined,
  };
}

export function validateRequiredFields<T extends Record<string, unknown>>(
  data: Partial<T>,
  requiredFields: (keyof T)[]
): ValidationResult<Partial<T>> {
  const errors: string[] = [];
  
  for (const field of requiredFields) {
    const value = data[field];
    if (value === undefined || value === null || value === '') {
      errors.push(`${String(field)} is required`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? data : undefined,
  };
}

export function validateEmail(email: string): ValidationResult<string> {
  const errors: string[] = [];
  const sanitized = sanitizeString(email).toLowerCase();
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    errors.push('Invalid email format');
  }
  
  if (sanitized.length > 254) {
    errors.push('Email must not exceed 254 characters');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? sanitized : undefined,
  };
}

export function validateDate(dateString: string, fieldName = 'Date'): ValidationResult<Date> {
  const errors: string[] = [];
  const sanitized = sanitizeString(dateString);
  
  const date = new Date(sanitized);
  if (isNaN(date.getTime())) {
    errors.push(`${fieldName} must be a valid date`);
  } else if (date > new Date()) {
    errors.push(`${fieldName} cannot be in the future`);
  } else if (date < new Date('1900-01-01')) {
    errors.push(`${fieldName} must be after 1900`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitizedData: errors.length === 0 ? date : undefined,
  };
}