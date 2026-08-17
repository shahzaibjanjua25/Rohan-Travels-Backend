// utils/format.js

/**
 * Format date
 */
export const date = (dateString, options = {}) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'N/A';

    const defaultOptions = {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...options
    };

    return d.toLocaleDateString('en-PK', defaultOptions);
};

/**
 * Format time
 */
export const time = (dateString) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'N/A';

    return d.toLocaleTimeString('en-PK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
};

/**
 * Format currency - PKR by default
 */
// src/utils/format.js

export const money = (amount, currency = 'PKR') => {
    if (amount === null || amount === undefined) return 'N/A';

    const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });

    // Replace $ with PKR if needed
    let formatted = formatter.format(amount);

    // If currency is PKR, ensure it shows PKR instead of Rs or $
    if (currency === 'PKR') {
        // Replace any currency symbol with PKR
        formatted = formatted.replace(/[^\d,.]/g, '');
        return `PKR ${formatted}`;
    }

    return formatted;
};

/**
 * Format duration
 */
export const duration = (minutes) => {
    if (!minutes) return '0h';

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
};

/**
 * Input date for date fields
 */
export const inputDate = () => {
    return new Date().toISOString().split('T')[0];
};

/**
 * Format number with plural
 */
export const plural = (count, singular, plural) => {
    if (count === 1) return `${count} ${singular}`;
    return `${count} ${plural || singular + 's'}`;
};

/**
 * Format input date
 */
export const formatDateInput = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
};