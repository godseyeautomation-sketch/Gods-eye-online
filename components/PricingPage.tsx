import React from 'react';
import { Check, Sparkles } from 'lucide-react';

export const PricingPage: React.FC = () => {
    const tiers = [
        {
            name: 'Starter',
            price: 1599,
            period: 'month',
            features: [
                '2,000 Credits monthly',
                '100 refresh credits every day',
                'Access to all video models',
                'Access to all image and editing models',
                '2 concurrent tasks',
                'Commercial license'
            ],
            notIncluded: ['Unlimited access', 'Priority support', 'Credit refill discount'],
            cta: 'Upgrade',
            highlighted: false
        },
        {
            name: 'Basic',
            price: 2699,
            period: 'month',
            features: [
                '3,500 Credits monthly',
                '100 refresh credits every day',
                'Access to all video models',
                'Access to all image and editing models',
                '4 concurrent tasks',
                'Commercial license',
                'UNLIMITED ACCESS'
            ],
            notIncluded: ['Priority support', 'Credit refill discount'],
            cta: 'Upgrade',
            highlighted: false
        },
        {
            name: 'Pro',
            price: 5799,
            period: 'month',
            originalPrice: 6699,
            features: [
                '11,000 Credits monthly',
                '100 refresh credits every day',
                'Access to all video models',
                'Access to all image and editing models',
                '8 concurrent tasks',
                "10% discount on credit refills",
                'Commercial license'
            ],
            notIncluded: [],
            cta: 'Upgrade',
            highlighted: true,
            badge: 'Expert Choice'
        },
        {
            name: 'Ultimate',
            price: 12499,
            period: 'month',
            originalPrice: 16599,
            features: [
                '27,000 Credits monthly',
                '100 refresh credits every day',
                'Access to all video models',
                'Access to all image and editing models',
                '10 concurrent tasks',
                "10% discount on credit refills",
                'Commercial license'
            ],
            notIncluded: [],
            cta: 'Upgrade',
            highlighted: false,
            badge: 'Christmas Sales Week'
        }
    ];

    return (
        <div className="min-h-screen bg-bg pt-32 pb-20 px-4">
            <div className="max-w-7xl mx-auto animate-fade-in">
                {/* Header */}
                <div className="text-center mb-16">
                    <div className="inline-flex items-center gap-2 bg-brand/10 border border-brand/20 rounded-full px-4 py-1.5 mb-6">
                        <Sparkles size={14} className="text-brand" />
                        <span className="text-xs font-bold text-brand uppercase tracking-wider">Pricing</span>
                    </div>
                    <h1 className="text-5xl font-black text-text-primary mb-4">
                        Choose Your Perfect Plan
                    </h1>
                    <p className="text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed">
                        Unlock the power of AI-generated content with flexible pricing designed for creators
                    </p>
                </div>

                {/* Pricing Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
                    {tiers.map((tier, i) => (
                        <div
                            key={tier.name}
                            className={`relative rounded-3xl p-8 transition-all duration-300 ease-out group
                                ${tier.highlighted
                                    ? 'bg-gradient-to-br from-brand/15 to-brand/5 backdrop-blur-xl border border-brand/30 scale-105 shadow-[0_0_40px_rgba(204,255,0,0.12)]'
                                    : 'bg-panel/60 backdrop-blur-xl border border-white/5 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-brand/5 hover:border-white/10'
                                }`}
                            style={{ animationDelay: `${i * 80}ms` }}
                        >
                            {tier.badge && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand text-bg px-4 py-1.5 rounded-full text-xs font-bold shadow-lg shadow-brand/30 backdrop-blur-md">
                                    {tier.badge}
                                </div>
                            )}

                            <div className="text-center mb-6">
                                <h3 className="text-2xl font-bold text-text-primary mb-2">{tier.name}</h3>
                                <div className="flex items-baseline justify-center gap-2">
                                    {(tier as any).originalPrice && (
                                        <span className="text-2xl font-bold text-text-secondary line-through opacity-50">{(tier as any).originalPrice.toLocaleString()}</span>
                                    )}
                                    <span className="text-5xl font-black text-brand">{tier.price.toLocaleString()}</span>
                                </div>
                                <div className="text-text-secondary text-sm mt-1">/{tier.period}</div>
                                {(tier as any).originalPrice && (
                                    <div className="text-xs text-text-secondary/70 mt-1">Renews at {(tier as any).originalPrice.toLocaleString()}/mo next month</div>
                                )}
                            </div>

                            {/* Features */}
                            <ul className="space-y-3 mb-8">
                                {tier.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                        <div className="w-5 h-5 rounded-full bg-brand/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <Check size={12} className="text-brand" />
                                        </div>
                                        <span className="text-sm text-text-primary">{feature}</span>
                                    </li>
                                ))}
                                {tier.notIncluded.map((feature, idx) => (
                                    <li key={`not-${idx}`} className="flex items-start gap-3 opacity-30">
                                        <span className="text-text-secondary text-sm w-5 text-center">✕</span>
                                        <span className="text-sm text-text-secondary line-through">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            {/* CTA Button */}
                            <button
                                className={`w-full py-3 rounded-full font-bold transition-all duration-300 ease-out
                                    ${tier.highlighted
                                        ? 'bg-brand text-bg hover:brightness-110 active:scale-95 shadow-lg shadow-brand/20 hover:shadow-brand/40'
                                        : 'bg-white/5 text-text-primary border border-white/10 hover:bg-brand hover:text-bg hover:border-brand hover:shadow-lg hover:shadow-brand/20 active:scale-95'
                                    }`}
                            >
                                {tier.cta}
                            </button>
                        </div>
                    ))}
                </div>

                {/* Feature Comparison Table */}
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-3xl p-8 ring-1 ring-white/[0.03]">
                    <h2 className="text-3xl font-bold text-text-primary mb-8 text-center">Feature Comparison</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-white/[0.03] rounded-xl">
                                    <th className="text-left py-4 px-4 text-text-secondary font-bold rounded-l-xl">Feature</th>
                                    {tiers.map((tier, i) => (
                                        <th key={tier.name} className={`text-center py-4 px-4 font-bold ${tier.highlighted ? 'text-brand' : 'text-text-primary'} ${i === tiers.length - 1 ? 'rounded-r-xl' : ''}`}>{tier.name}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="text-sm">
                                {[
                                    { label: 'Credits/month', values: ['2,000', '3,500', '11,000', '27,000'], highlight: [false, false, true, true] },
                                    { label: 'Daily refresh credits', values: ['100', '100', '100', '100'], highlight: [false, false, false, false] },
                                    { label: 'Concurrent tasks', values: ['2', '4', '8', '10'], highlight: [false, false, false, false] },
                                    { label: 'Unlimited Access', values: ['\u2014', '\u2713', '\u2713', '\u2713'], highlight: [false, true, true, true] },
                                    { label: 'Credit refill discount', values: ['\u2014', '\u2014', '10%', '10%'], highlight: [false, false, true, true] },
                                ].map((row, rowIdx) => (
                                    <tr key={row.label} className={`transition-colors duration-200 hover:bg-white/[0.02] ${rowIdx % 2 === 1 ? 'bg-white/[0.01]' : ''}`}>
                                        <td className="py-4 px-4 text-text-secondary rounded-l-lg">{row.label}</td>
                                        {row.values.map((val, i) => (
                                            <td key={i} className={`text-center py-4 px-4 ${row.highlight[i] ? 'text-brand font-bold' : val === '\u2014' ? 'text-text-secondary/40' : 'text-text-primary'} ${i === row.values.length - 1 ? 'rounded-r-lg' : ''}`}>
                                                {val}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
