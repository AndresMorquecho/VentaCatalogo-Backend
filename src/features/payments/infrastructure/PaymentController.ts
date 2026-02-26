
import { Request, Response } from 'express';
import { RegisterOrderPaymentUseCase } from '../application/RegisterOrderPayment.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';

export class PaymentController {
    constructor(private registerOrderPaymentUseCase: RegisterOrderPaymentUseCase) { }

    registerPayment = async (req: AuthRequest, res: Response) => {
        try {
            const orderId = req.body.orderId || req.body.order_id;
            const amount = req.body.amount;
            const creditAmount = req.body.creditAmount ?? req.body.credit_amount;
            const method = req.body.method || req.body.payment_method;
            const referenceNumber = req.body.referenceNumber || req.body.reference_number;
            const bankAccountId = req.body.bankAccountId || req.body.bank_account_id;
            const notes = req.body.notes;

            console.log("PAYMENT REQ BODY:", req.body);

            if (!orderId) {
                return HttpResponse.badRequest(res, 'Missing required field: orderId is required.');
            }

            const parsedAmount = Number(amount || 0);
            const parsedCreditAmount = Number(creditAmount || 0);

            if (parsedAmount <= 0 && parsedCreditAmount <= 0) {
                return HttpResponse.badRequest(res, 'At least one of amount or creditAmount must be greater than zero.');
            }

            if (parsedAmount > 0 && (!method || !bankAccountId)) {
                return HttpResponse.badRequest(res, 'Missing required fields: method and bankAccountId are required for manual payments.');
            }

            const dto = {
                orderId,
                amount: parsedAmount,
                method: method || 'EFECTIVO',
                referenceNumber,
                bankAccountId,
                notes,
                creditAmount: parsedCreditAmount
            };

            const result = await this.registerOrderPaymentUseCase.execute(dto, req.user!.username);

            if (result.isFailure) {
                console.error('[PaymentController] Registration failure:', result.error);
                return HttpResponse.fail(res, result.error!);
            }

            return HttpResponse.created(res, result.getValue());
        } catch (error) {
            console.error('[PaymentController] Unexpected error during payment registration:', error);
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'An unexpected error occurred during payment registration.');
        }
    };
}
