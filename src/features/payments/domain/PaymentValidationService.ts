import { prisma } from '../../../lib/prisma';
import { FinancialIntegrityError } from '../../../shared/errors/FinancialIntegrityError';

export interface OrderAllocation {
  orderId: string;
  amount: number;
}

export interface PaymentMethodAllocation {
  method: 'EFECTIVO' | 'TRANSFERENCIA' | 'BILLETERA_VIRTUAL';
  amount: number;
  bankAccountId?: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  code?: string;
  details?: any;
}

export class PaymentValidationService {
  /**
   * VALIDACIÓN CRÍTICA: Verificar que totales coincidan exactamente
   */
  validatePaymentTotals(
    orders: OrderAllocation[], 
    payments: PaymentMethodAllocation[], 
    total: number
  ): ValidationResult {
    const orderTotal = orders.reduce((sum, order) => sum + order.amount, 0);
    const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
    
    // VALIDACIÓN 1: Order total debe coincidir con total esperado
    if (Math.abs(orderTotal - total) > 0.01) {
      return {
        isValid: false,
        error: `Order total (${orderTotal.toFixed(2)}) does not match expected total (${total.toFixed(2)})`,
        code: 'ORDER_TOTAL_MISMATCH',
        details: { orderTotal, expectedTotal: total, difference: orderTotal - total }
      };
    }
    
    // VALIDACIÓN 2: Payment total debe coincidir con total esperado
    if (Math.abs(paymentTotal - total) > 0.01) {
      return {
        isValid: false,
        error: `Payment total (${paymentTotal.toFixed(2)}) does not match expected total (${total.toFixed(2)})`,
        code: 'PAYMENT_TOTAL_MISMATCH',
        details: { paymentTotal, expectedTotal: total, difference: paymentTotal - total }
      };
    }
    
    return { isValid: true };
  }

  /**
   * VALIDACIÓN CRÍTICA: Verificar saldo de billetera suficiente
   */
  async validateWalletBalance(clientId: string, requestedAmount: number): Promise<ValidationResult> {
    try {
      // Obtener créditos disponibles del cliente
      const availableCredits = await prisma.clientCredit.findMany({
        where: {
          clientAccount: { clientId },
          status: 'AVAILABLE'
        },
        select: { remainingAmount: true }
      });
      
      const totalAvailable = availableCredits.reduce(
        (sum, credit) => sum + Number(credit.remainingAmount), 
        0
      );
      
      if (totalAvailable < requestedAmount - 0.01) { // Allow small floating point errors
        return {
          isValid: false,
          error: `Insufficient wallet balance. Available: ${totalAvailable.toFixed(2)}, Requested: ${requestedAmount.toFixed(2)}`,
          code: 'WALLET_INSUFFICIENT',
          details: { 
            available: totalAvailable, 
            requested: requestedAmount,
            shortage: requestedAmount - totalAvailable
          }
        };
      }
      
      return { isValid: true };
    } catch (error) {
      console.error('PaymentValidationService.validateWalletBalance Error:', error);
      return {
        isValid: false,
        error: 'Unable to verify wallet balance',
        code: 'WALLET_VALIDATION_ERROR',
        details: { originalError: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * VALIDACIÓN: Verificar que cuentas bancarias existen y están activas
   */
  async validateBankAccounts(payments: PaymentMethodAllocation[]): Promise<ValidationResult> {
    try {
      const bankAccountIds = payments
        .filter(p => p.method !== 'BILLETERA_VIRTUAL' && p.bankAccountId)
        .map(p => p.bankAccountId!);
      
      if (bankAccountIds.length === 0) {
        return { isValid: true }; // No bank accounts to validate
      }
      
      const bankAccounts = await prisma.bankAccount.findMany({
        where: {
          id: { in: bankAccountIds },
          isActive: true
        },
        select: { id: true, name: true }
      });
      
      const foundIds = bankAccounts.map(ba => ba.id);
      const missingIds = bankAccountIds.filter(id => !foundIds.includes(id));
      
      if (missingIds.length > 0) {
        return {
          isValid: false,
          error: `Bank accounts not found or inactive: ${missingIds.join(', ')}`,
          code: 'BANK_ACCOUNT_NOT_FOUND',
          details: { missingIds, foundAccounts: bankAccounts }
        };
      }
      
      return { isValid: true };
    } catch (error) {
      console.error('PaymentValidationService.validateBankAccounts Error:', error);
      return {
        isValid: false,
        error: 'Unable to verify bank accounts',
        code: 'BANK_VALIDATION_ERROR',
        details: { originalError: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * VALIDACIÓN: Verificar que todos los montos sean positivos
   */
  validatePositiveAmounts(amounts: number[]): ValidationResult {
    const negativeAmounts = amounts.filter(amount => amount < 0);
    
    if (negativeAmounts.length > 0) {
      return {
        isValid: false,
        error: `Negative amounts are not allowed: ${negativeAmounts.join(', ')}`,
        code: 'NEGATIVE_AMOUNT',
        details: { negativeAmounts }
      };
    }
    
    // Verificar que no haya montos de cero (excepto casos específicos)
    const zeroAmounts = amounts.filter(amount => amount === 0);
    if (zeroAmounts.length > 0) {
      return {
        isValid: false,
        error: 'Zero amounts are not allowed',
        code: 'ZERO_AMOUNT',
        details: { zeroCount: zeroAmounts.length }
      };
    }
    
    return { isValid: true };
  }

  /**
   * VALIDACIÓN: Verificar idempotencia - si el request ya fue procesado
   */
  async validateIdempotency(requestId: string): Promise<ValidationResult> {
    try {
      const existingRequest = await prisma.processingRequest.findUnique({
        where: { requestId },
        select: { status: true, createdAt: true, result: true, error: true }
      });
      
      if (existingRequest) {
        if (existingRequest.status === 'PROCESSING') {
          // Verificar si es un request "colgado" (más de 5 minutos)
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          if (existingRequest.createdAt < fiveMinutesAgo) {
            return { 
              isValid: true,
              details: { allowRetry: true, reason: 'stale_request' }
            }; // Permitir retry
          }
          
          return {
            isValid: false,
            error: 'Request is already being processed',
            code: 'REQUEST_IN_PROGRESS',
            details: { status: existingRequest.status, createdAt: existingRequest.createdAt }
          };
        }
        
        if (existingRequest.status === 'COMPLETED') {
          return {
            isValid: false,
            error: 'Request has already been completed',
            code: 'REQUEST_ALREADY_COMPLETED',
            details: { 
              status: existingRequest.status, 
              result: existingRequest.result 
            }
          };
        }
        
        if (existingRequest.status === 'FAILED') {
          return { 
            isValid: true,
            details: { allowRetry: true, reason: 'previous_failure', previousError: existingRequest.error }
          }; // Permitir retry para requests fallidos
        }
      }
      
      return { isValid: true };
    } catch (error) {
      console.error('PaymentValidationService.validateIdempotency Error:', error);
      return {
        isValid: false,
        error: 'Unable to verify request idempotency',
        code: 'IDEMPOTENCY_VALIDATION_ERROR',
        details: { originalError: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * VALIDACIÓN: Verificar que las órdenes existen y están en estado válido
   */
  async validateOrdersExist(orders: OrderAllocation[]): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const orderIds = orders.map(o => o.orderId);
      
      const foundOrders = await prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { 
          id: true, 
          clientId: true, 
          clientName: true, 
          status: true, 
          total: true 
        }
      });
      
      const foundIds = foundOrders.map(o => o.id);
      const missingIds = orderIds.filter(id => !foundIds.includes(id));
      
      if (missingIds.length > 0) {
        return {
          success: false,
          error: `Orders not found: ${missingIds.join(', ')}`
        };
      }
      
      return { success: true, data: foundOrders };
    } catch (error) {
      console.error('PaymentValidationService.validateOrdersExist Error:', error);
      return {
        success: false,
        error: 'Unable to verify orders existence'
      };
    }
  }

  /**
   * UTILIDAD: Obtener cuenta bancaria por defecto para un método de pago
   */
  async getDefaultBankAccount(paymentMethod: string): Promise<string> {
    const defaultAccount = await prisma.bankAccount.findFirst({
      where: { 
        isActive: true,
        type: paymentMethod === 'EFECTIVO' ? 'CASH' : 'BANK'
      },
      select: { id: true }
    });
    
    if (!defaultAccount) {
      throw new FinancialIntegrityError(
        `No default bank account found for payment method: ${paymentMethod}`,
        'OTHER'
      );
    }
    
    return defaultAccount.id;
  }
}