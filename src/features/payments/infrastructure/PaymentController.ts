
import { Request, Response } from 'express';
import { RegisterOrderPaymentUseCase } from '../application/RegisterOrderPayment.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';

export class PaymentController {
    constructor(private registerOrderPaymentUseCase: RegisterOrderPaymentUseCase) { }

    registerPayment = async (req: AuthRequest, res: Response) => {
        try {
            const orderId = req.body.order_id || req.body.orderId;
            const amount = req.body.amount;
            const method = req.body.method;
            const referenceNumber = req.body.reference_number || req.body.referenceNumber;
            const bankAccountId = req.body.bank_account_id || req.body.bankAccountId;
            const notes = req.body.notes;

            if (!orderId || amount === undefined || !method || !bankAccountId) {
                return HttpResponse.badRequest(res, 'Missing required fields: orderId, amount, method, and bankAccountId are required.');
            }

            const dto = {
                orderId,
                amount: Number(amount),
                method,
                referenceNumber,
                bankAccountId,
                notes
            };

            const result = await this.registerOrderPaymentUseCase.execute(dto, req.user!.email);

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
